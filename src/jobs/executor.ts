import type { DiscoveryEvent, DiscoveryEventSink } from "@/discovery/events";
import { runDiscovery } from "@/discovery/runDiscovery";
import { readDiscoveryRuntimeConfig } from "@/discovery/config";
import type { SourceName } from "@/core/discovery/types";
import { getDiscoveryJobStore } from "@/jobs/store";
import type { DiscoveryJob, DiscoveryJobStatus } from "@/jobs/types";

const stageByEvent: Partial<Record<DiscoveryEvent["type"], DiscoveryJobStatus>> = {
  planning_started: "planning",
  planning_completed: "planning",
  source_started: "collecting",
  source_progress: "collecting",
  source_completed: "collecting",
  source_degraded: "collecting",
  source_auth_required: "collecting",
  enrichment_started: "enriching",
  verification_started: "verifying",
  dedupe_completed: "verifying",
  persistence_started: "persisting",
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
      return 90;
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

  if (job.status === "cancelled" || job.cancelRequested) {
    return store.updateJob(job.id, {
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      currentStage: "cancelled",
    });
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
      const saved = await store.appendEvent(job.id, event);
      const status = stageByEvent[saved.type];
      if (status && !["completed", "failed", "cancelled"].includes(status)) {
        await store.updateJob(job.id, {
          status,
          currentStage: status,
          progress: progressFor(saved.type),
        });
      }
    },
  };

  try {
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
    });

    if (result.cancelled) {
      return store.updateJob(job.id, {
        status: "cancelled",
        progress: 100,
        currentStage: "cancelled",
        cancelledAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        effectiveSources: result.effectiveSources,
        durationMs: result.summary.durationMs,
        safeErrorMessage: "Cancelled",
      });
    }

    const summary = result.summary;
    return store.updateJob(job.id, {
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
        warnings: summary.warnings,
        errors: summary.errors,
        sourceStats: summary.sourceStats,
        agent: summary.agent ?? null,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Discovery job failed";
    await store.appendEvent(job.id, {
      type: "run_failed",
      level: "error",
      message,
    });
    return store.updateJob(job.id, {
      status: "failed",
      progress: 100,
      currentStage: "failed",
      completedAt: new Date().toISOString(),
      failureCategory: "execution_error",
      safeErrorMessage: message.slice(0, 500),
    });
  } finally {
    clearTimeout(timeout);
    clearInterval(cancelPoll);
  }
}
