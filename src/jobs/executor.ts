import type { DiscoveryEvent, DiscoveryEventSink } from "@/discovery/events";
import { runDiscovery } from "@/discovery/runDiscovery";
import { readDiscoveryRuntimeConfig } from "@/discovery/config";
import { compactSourceStatsForSummary } from "@/discovery/sourceTelemetry";
import type { SourceName } from "@/core/discovery/types";
import { getDiscoveryJobStore } from "@/jobs/store";
import { getTerminalSessionStore } from "@/server/terminal";
import type { DiscoveryJob, DiscoveryJobStatus } from "@/jobs/types";

const stageByEvent: Partial<Record<DiscoveryEvent["type"], DiscoveryJobStatus>> = {
  planning_started: "planning",
  planning_completed: "planning",
  query_interpreted: "planning",
  source_started: "collecting",
  source_progress: "collecting",
  source_completed: "collecting",
  source_degraded: "collecting",
  source_auth_required: "collecting",
  enrichment_started: "enriching",
  verification_started: "verifying",
  dedupe_completed: "verifying",
  result_summary_updated: "verifying",
  persistence_started: "persisting",
  persistence_completed: "persisting",
  run_completed: "completed",
  run_failed: "failed",
  run_cancelled: "cancelled",
};

function progressFor(type: DiscoveryEvent["type"]): number {
  switch (type) {
    case "run_queued":
      return 0;
    case "run_started":
    case "planning_started":
      return 5;
    case "planning_completed":
      return 15;
    case "source_started":
    case "source_progress":
      return 35;
    case "source_completed":
    case "source_degraded":
    case "source_auth_required":
      return 55;
    case "enrichment_started":
      return 65;
    case "verification_started":
      return 75;
    case "dedupe_completed":
      return 85;
    case "persistence_started":
    case "persistence_completed":
      return 90;
    case "result_summary_updated":
      return 88;
    case "query_interpreted":
      return 12;
    case "run_completed":
      return 100;
    case "run_failed":
    case "run_cancelled":
      return 100;
    default:
      return 10;
  }
}

export type ExecuteDiscoveryJobOptions = {
  jobId: string;
  workerId?: string;
};

type PendingTerminalEvent = Omit<
  DiscoveryEvent,
  "id" | "runId" | "sequence" | "timestamp"
> & {
  id?: string;
  sequence?: number;
  timestamp?: string;
};

/**
 * Execute a queued discovery job via the shared discovery service.
 * Used by local in-process executor and the worker skeleton.
 */
export async function executeDiscoveryJob(
  options: ExecuteDiscoveryJobOptions,
): Promise<DiscoveryJob> {
  const store = getDiscoveryJobStore();
  const config = readDiscoveryRuntimeConfig();
  const job = await store.getJob(options.jobId);
  if (!job) throw new Error(`Discovery job not found: ${options.jobId}`);
  const pendingTerminalEvent: { current: PendingTerminalEvent | null } = {
    current: null,
  };

  if (job.status === "cancelled" || job.cancelRequested) {
    const transitioned = await store.transitionToTerminal(job.id, {
      status: "cancelled",
      progress: 100,
      cancelledAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      currentStage: "cancelled",
      safeErrorMessage: "Cancelled",
    }, {
      type: "run_cancelled",
      level: "warning",
      message: "Discovery run cancelled",
    });
    return transitioned?.job ?? job;
  }

  await store.markStarted(job.id, { status: "planning", currentStage: "planning" });
  await store.appendEvent(job.id, {
    type: "run_queued",
    level: "info",
    message: "Job claimed for execution",
    metadata: { workerId: options.workerId ?? "local" },
  });

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), config.jobTimeoutMs);

  const cancelPoll = setInterval(() => {
    void store.getJob(job.id).then((latest) => {
      if (latest?.cancelRequested || latest?.status === "cancelled") {
        abort.abort();
      }
    });
  }, 750);

  const eventSink: DiscoveryEventSink = {
    async emit(event) {
      const status = stageByEvent[event.type];
      if (status && ["completed", "failed", "cancelled"].includes(status)) {
        pendingTerminalEvent.current = event;
        return;
      }
      const saved = await store.appendEvent(job.id, event);
      const nextStatus = stageByEvent[saved.type];
      if (nextStatus && !["completed", "failed", "cancelled"].includes(nextStatus)) {
        await store.updateJob(job.id, {
          status: nextStatus,
          currentStage: nextStatus,
          progress: progressFor(saved.type),
        });
      }
    },
  };

  const detachTerminalActiveJob = async () => {
    try {
      const terminalStore = getTerminalSessionStore();
      const sessions = await terminalStore.listSessions({
        includeClosed: true,
        limit: 200,
      });
      await Promise.all(
        sessions
          .filter((session) => session.activeJobId === job.id)
          .map((session) =>
            terminalStore.detachCompletedActiveJob(session.id, job.id),
          ),
      );
    } catch {
      // Terminal session persistence is best-effort relative to job completion.
    }
  };

  try {
    const executionStartedAt = Date.now();
    const createdAtMs = Date.parse(job.createdAt);
    const queueWaitMs = Number.isFinite(createdAtMs)
      ? Math.max(0, executionStartedAt - createdAtMs)
      : undefined;
    const result = await runDiscovery({
      command: job.command,
      mode: job.mode,
      sources:
        job.requestedSources.length > 0
          ? (job.requestedSources as SourceName[])
          : undefined,
      dryRun: job.dryRun,
      allSources: job.allSources,
      maxAgentCalls: job.maxAgentCalls ?? undefined,
      runId: job.id,
      eventSink,
      cancellationSignal: abort.signal,
      queueWaitMs,
      jobStartOverheadMs: Math.max(0, Date.now() - executionStartedAt),
    });

    if (result.cancelled) {
      const terminal = pendingTerminalEvent.current?.type === "run_cancelled"
        ? pendingTerminalEvent.current
        : {
            type: "run_cancelled" as const,
            level: "warning" as const,
            message: "Discovery run cancelled",
          };
      const transitioned = await store.transitionToTerminal(job.id, {
        status: "cancelled",
        progress: 100,
        currentStage: "cancelled",
        cancelledAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        effectiveSources: result.effectiveSources,
        durationMs: result.summary.durationMs,
        safeErrorMessage: "Cancelled",
      }, terminal);
      await detachTerminalActiveJob();
      return transitioned?.job ?? (await store.getJob(job.id)) ?? job;
    }

    const summary = result.summary;
    const terminal = pendingTerminalEvent.current?.type === "run_completed"
      ? pendingTerminalEvent.current
      : {
          type: "run_completed" as const,
          level: "success" as const,
          message: summary.dryRun
            ? `Would create ${summary.wouldCreate}, would update ${summary.wouldUpdate}`
            : `${summary.created} created, ${summary.updated} updated`,
        };
    const transitioned = await store.transitionToTerminal(job.id, {
      status: "completed",
      progress: 100,
      currentStage: "completed",
      completedAt: new Date().toISOString(),
      effectiveSources: result.effectiveSources,
      createdCount: summary.dryRun ? summary.wouldCreate : summary.created,
      updatedCount: summary.dryRun ? summary.wouldUpdate : summary.updated,
      acceptedCount: summary.accepted,
      rejectedCount: summary.rejected,
      needsReviewCount: summary.needsReview,
      rawLeadsCount: summary.rawLeads,
      durationMs: summary.durationMs,
      summary: {
        dryRun: summary.dryRun,
        verbose: summary.verbose,
        profile: summary.preferences.profile ?? null,
        rawLeads: summary.rawLeads,
        uniqueLeads: summary.uniqueLeads,
        accepted: summary.accepted,
        queueReady: Math.max(0, summary.accepted - summary.needsReview),
        rejected: summary.rejected,
        needsReview: summary.needsReview,
        created: summary.dryRun ? summary.wouldCreate : summary.created,
        updated: summary.dryRun ? summary.wouldUpdate : summary.updated,
        durationMs: summary.durationMs,
        warnings: summary.warnings,
        errors: summary.errors,
        sourceStats: compactSourceStatsForSummary(summary.sourceStats),
        sourceAccounting: summary.sourceAccounting,
        acceptedCandidates: summary.acceptedCandidates,
        agent: summary.agent ?? null,
        performance: summary.performance ?? null,
      },
    }, terminal);
    await detachTerminalActiveJob();
    return transitioned?.job ?? (await store.getJob(job.id)) ?? job;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Discovery job failed";
    const terminal = pendingTerminalEvent.current?.type === "run_failed"
      ? pendingTerminalEvent.current
      : {
          type: "run_failed" as const,
          level: "error" as const,
          message,
        };
    const transitioned = await store.transitionToTerminal(job.id, {
      status: "failed",
      progress: 100,
      currentStage: "failed",
      completedAt: new Date().toISOString(),
      failureCategory: "execution_error",
      safeErrorMessage: message.slice(0, 500),
    }, terminal);
    await detachTerminalActiveJob();
    return transitioned?.job ?? (await store.getJob(job.id)) ?? job;
  } finally {
    clearTimeout(timeout);
    clearInterval(cancelPoll);
  }
}
