import { randomUUID } from "node:crypto";
import type { Json } from "@/lib/supabase/database.types";
import { runCollectors } from "@/collectors/registry";
import { DEFAULT_COLLECTOR_TIMEOUT_MS } from "@/collectors/types";
import { hasSupabaseConfig, getServerEnv } from "@/config/env";
import type {
  AcceptedCandidate,
  AgentRunSummary,
  DiscoveryPreferences,
  RejectedCandidate,
  ScoringResult,
  SourceName,
  SourceRunStats,
} from "@/core/discovery/types";
import {
  classifyHackathonEvent,
  shouldEnterNormalScoring,
} from "@/core/classifyEventPage";
import { enrichPromisingLeads } from "@/core/enrichLead";
import { extractHackathonEvents } from "@/core/extract";
import { mergeCrossSourceEvents } from "@/core/mergeEvents";
import { scoreHackathonEvent } from "@/core/score";
import { verifyHackathonEvent } from "@/core/verify";
import { sourceAuthority } from "@/core/dedupe";
import { addEvidence, upsertCandidateByFingerprint } from "@/server/candidates/repository";
import { completeAgentRun, createAgentRun } from "@/server/agent/runs";
import {
  buildAcceptedSummary,
  deadlineStateFor,
  emptySummary,
  eventEvidenceToAddInput,
  eventToUpsertInput,
} from "@/agent/summary";
import { formatSearchPlan, planSearchQueries } from "@/agent/planSearchQueries";
import { formatXPlan, planXQueries } from "@/agent/planXQueries";
import {
  createEventEmitter,
  type DiscoveryEventSink,
} from "@/discovery/events";

const SUPABASE_ENV_MESSAGE =
  "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env.local, or run with --dry-run.";

const MOCK_WRITE_REFUSED_MESSAGE =
  'Refusing to upsert mock-sourced candidates into the live database while USE_MOCK_CANDIDATES=false. Re-run with --dry-run, set USE_MOCK_CANDIDATES=true for local fixtures, or pass --allow-mock-writes to override.';

const DEFAULT_TOTAL_TIMEOUT_MS = 45_000;

export type DiscoveryPipelineOptions = {
  allowMockWrites?: boolean;
  sourceTimeoutMs?: number;
  totalTimeoutMs?: number;
  showSearchPlan?: boolean;
  showXPlan?: boolean;
  dryRunPlan?: boolean;
  verbose?: boolean;
  agentObservability?: AgentRunSummary["agent"];
  now?: Date;
  runId?: string;
  eventSink?: DiscoveryEventSink;
  cancellationSignal?: AbortSignal;
  /** When true, search/X plan text is emitted as events instead of console.log. */
  emitPlansAsEvents?: boolean;
};

function initSourceStats(sources: SourceName[]): Map<SourceName, SourceRunStats> {
  const stats = new Map<SourceName, SourceRunStats>();
  for (const source of sources) {
    stats.set(source, {
      source,
      leadsFound: 0,
      accepted: 0,
      rejected: 0,
      errors: [],
      warnings: [],
      durationMs: 0,
    });
  }
  return stats;
}

function assertMockWritesAllowed(
  preferences: DiscoveryPreferences,
  dryRun: boolean,
  allowMockWrites: boolean,
): void {
  if (dryRun || allowMockWrites) return;
  if (!preferences.sources.includes("mock")) return;

  const env = getServerEnv();
  if (env.USE_MOCK_CANDIDATES) return;

  throw new Error(MOCK_WRITE_REFUSED_MESSAGE);
}

function reviewOnlyScore(reasons: string[], redFlags: string[]): ScoringResult {
  return {
    score: 0,
    whyMatch: ["Needs human review before scoring"],
    redFlags: [...new Set([...reasons, ...redFlags])],
    rejected: false,
  };
}

function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Discovery run cancelled");
    error.name = "DiscoveryCancelledError";
    throw error;
  }
}

export function isDiscoveryCancelledError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "DiscoveryCancelledError" ||
      error.message === "Discovery run cancelled")
  );
}

/**
 * Core discovery pipeline shared by CLI and web job executors.
 * Emits structured progress events; does not write directly to stdout.
 */
export async function executeDiscoveryPipeline(
  preferences: DiscoveryPreferences,
  dryRun: boolean,
  options: DiscoveryPipelineOptions = {},
): Promise<AgentRunSummary> {
  const startedAt = Date.now();
  const runId = options.runId ?? randomUUID();
  const emitter = createEventEmitter(runId, options.eventSink);
  const summary = emptySummary(preferences.rawCommand, preferences, dryRun);
  const sourceStats = initSourceStats(preferences.sources);
  const allowMockWrites = options.allowMockWrites === true;
  const sourceTimeoutMs = options.sourceTimeoutMs ?? DEFAULT_COLLECTOR_TIMEOUT_MS;
  const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const effectiveSourceTimeout = Math.min(sourceTimeoutMs, totalTimeoutMs);
  const now = options.now ?? new Date();
  summary.verbose = options.verbose === true;
  summary.agent = options.agentObservability;

  await emitter.emit("run_started", `Starting discovery for: ${preferences.rawCommand}`, {
    metadata: {
      sources: preferences.sources,
      dryRun,
    },
  });

  const logPlan = (label: string, body: string) => {
    if (options.emitPlansAsEvents) {
      void emitter.emit("source_progress", `${label}\n${body}`, {
        metadata: { plan: label },
      });
      return;
    }
    console.log(label);
    console.log(body);
    console.log("");
  };

  if (options.showSearchPlan || options.dryRunPlan) {
    const queries = planSearchQueries(preferences);
    logPlan("Search plan:", formatSearchPlan(queries));
  }

  if (options.showXPlan || (options.dryRunPlan && preferences.sources.includes("x"))) {
    const xQueries = planXQueries(preferences);
    logPlan("X plan:", formatXPlan(xQueries));
  }

  if (options.dryRunPlan) {
    summary.warnings.push("Dry-run plan only; collectors were not executed.");
    summary.durationMs = Date.now() - startedAt;
    summary.sourceStats = [...sourceStats.values()];
    await emitter.emit("run_completed", "Dry-run plan only; collectors were not executed.", {
      metadata: { dryRunPlan: true },
    });
    return summary;
  }

  assertMockWritesAllowed(preferences, dryRun, allowMockWrites);
  assertNotCancelled(options.cancellationSignal);

  if (!dryRun && !hasSupabaseConfig(getServerEnv())) {
    throw new Error(SUPABASE_ENV_MESSAGE);
  }

  let agentRunId: string | null = null;

  if (!dryRun) {
    try {
      agentRunId = await createAgentRun({
        command: preferences.rawCommand,
        preferences: preferences as unknown as Json,
        sources: preferences.sources,
      });
    } catch (error) {
      summary.warnings.push(
        `Failed to create agent run record: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  try {
    assertNotCancelled(options.cancellationSignal);

    for (const source of preferences.sources) {
      await emitter.emit("source_started", `Starting…`, { source });
    }

    const collectorPromise = runCollectors(
      {
        preferences,
        maxResults: preferences.maxResults,
        timeoutMs: effectiveSourceTimeout,
        dryRun,
        requestId: agentRunId ?? runId,
      },
      preferences.sources,
    );

    let timedOut = false;
    const collectorResults = await Promise.race([
      collectorPromise,
      new Promise<null>((resolve) => {
        setTimeout(() => {
          timedOut = true;
          resolve(null);
        }, totalTimeoutMs);
      }),
    ]).then(async (result) => {
      if (result) return result;
      summary.warnings.push(
        `Total collector budget ${totalTimeoutMs}ms reached; waiting briefly for in-flight collectors.`,
      );
      return Promise.race([
        collectorPromise,
        new Promise<Awaited<typeof collectorPromise>>((resolve) => {
          setTimeout(() => resolve([]), 2_000);
        }),
      ]);
    });

    assertNotCancelled(options.cancellationSignal);

    if (timedOut && collectorResults.length === 0) {
      summary.warnings.push(
        "Collectors returned no results before the total timeout grace period ended.",
      );
    }

    let leads = collectorResults.flatMap((result) => result.leads);
    summary.rawLeads = leads.length;

    for (const result of collectorResults) {
      const stats = sourceStats.get(result.source);
      if (!stats) continue;
      stats.leadsFound = result.leads.length;
      stats.durationMs = result.durationMs;
      stats.errors.push(...result.errors);
      stats.warnings.push(...result.warnings);
      summary.warnings.push(
        ...result.warnings.map((warning) => `[${result.source}] ${warning}`),
      );
      summary.errors.push(
        ...result.errors.map((error) => `[${result.source}] ${error}`),
      );

      const authRequired = result.errors.some((error) =>
        /auth|login|sign[\s-]?in|session/i.test(error),
      );
      const degraded =
        result.errors.length > 0 ||
        result.warnings.some((warning) => /degraded|timeout|rate/i.test(warning));

      if (authRequired) {
        await emitter.emit(
          "source_auth_required",
          result.errors[0] ?? "Authentication required",
          {
            source: result.source,
            level: "warning",
            metadata: { leadsFound: result.leads.length, durationMs: result.durationMs },
          },
        );
      } else if (degraded && result.leads.length === 0) {
        await emitter.emit(
          "source_degraded",
          result.errors[0] ?? result.warnings[0] ?? "Source degraded",
          {
            source: result.source,
            level: "warning",
            metadata: { leadsFound: 0, durationMs: result.durationMs },
          },
        );
      } else {
        await emitter.emit(
          "source_completed",
          `${result.leads.length} leads found`,
          {
            source: result.source,
            metadata: {
              leadsFound: result.leads.length,
              durationMs: result.durationMs,
              errors: result.errors.length,
              warnings: result.warnings.length,
            },
          },
        );
      }

      if (result.source === "x" && result.metrics) {
        const m = result.metrics;
        summary.xDiscovery = {
          queriesPlanned: m.queriesPlanned ?? 0,
          queriesExecuted: m.queriesExecuted ?? 0,
          postsReturned: m.postsReturned ?? 0,
          postsDeduped: m.postsDeduped ?? 0,
          postsWithLinks: m.postsWithLinks ?? 0,
          postsKept: m.postsKept ?? result.leads.length,
          postsRejectedNoise: m.postsRejectedNoise ?? 0,
          pagesEnriched: 0,
          durationMs: result.durationMs,
          rateQuotaWarnings: m.rateQuotaWarnings ?? 0,
        };
      }
    }

    assertNotCancelled(options.cancellationSignal);
    await emitter.emit("enrichment_started", "Enriching promising leads…");

    const enrichment = await enrichPromisingLeads(leads, {
      timeoutMs: Math.min(10_000, effectiveSourceTimeout),
      maxPages: 15,
      concurrency: 4,
    });
    leads = enrichment.leads;
    summary.enriched = enrichment.enrichedCount;
    summary.warnings.push(...enrichment.warnings.map((warning) => `[enrich] ${warning}`));

    if (summary.xDiscovery) {
      const xLeadsAfter = leads.filter((lead) => lead.source === "x");
      summary.xDiscovery.pagesEnriched = xLeadsAfter.filter((lead) => {
        const meta = lead.metadata ?? {};
        return Boolean(meta.officialUrl || meta.enriched);
      }).length;
    }

    assertNotCancelled(options.cancellationSignal);
    await emitter.emit("verification_started", `${leads.length} raw leads`);

    const extracted = extractHackathonEvents(leads, { now });
    const merged = mergeCrossSourceEvents(extracted);
    summary.extracted = extracted.length;
    summary.uniqueLeads = merged.events.length;
    summary.crossSourceMerges = merged.mergeCount;
    summary.quality.crossSourceMerges = merged.mergeCount;

    await emitter.emit(
      "dedupe_completed",
      `${merged.events.length} unique candidates`,
      {
        metadata: {
          extracted: extracted.length,
          unique: merged.events.length,
          merges: merged.mergeCount,
        },
      },
    );

    const accepted: AcceptedCandidate[] = [];
    const rejected: RejectedCandidate[] = [];

    const bump = (source: SourceName, field: "accepted" | "rejected") => {
      const stats = sourceStats.get(source);
      if (stats) stats[field] += 1;
    };

    for (const event of merged.events) {
      assertNotCancelled(options.cancellationSignal);
      try {
        const classified = classifyHackathonEvent(event);

        if (classified.classification === "EVENT_DIRECTORY") {
          summary.quality.directoriesFiltered += 1;
          rejected.push({
            name: event.name,
            source: event.source,
            stage: "verification",
            reason: `Directory/category page — ${classified.reasons[0] ?? "not an individual event"}`,
          });
          bump(event.source, "rejected");
          continue;
        }

        if (classified.classification === "ARTICLE") {
          summary.quality.articlesFiltered += 1;
          rejected.push({
            name: event.name,
            source: event.source,
            stage: "verification",
            reason: `Article/listicle — ${classified.reasons[0] ?? "not an individual event"}`,
          });
          bump(event.source, "rejected");
          continue;
        }

        if (
          classified.classification === "ORGANIZATION_PAGE" ||
          classified.classification === "HISTORICAL_EVENT"
        ) {
          summary.quality.historicalOrExpiredFiltered += 1;
          rejected.push({
            name: event.name,
            source: event.source,
            stage: "verification",
            reason: `${classified.classification} — ${classified.reasons[0] ?? "filtered"}`,
          });
          bump(event.source, "rejected");
          continue;
        }

        if (classified.classification === "UNCERTAIN") {
          summary.quality.uncertainNeedsReview += 1;
          const verification = verifyHackathonEvent(event, { now });
          if (verification.status === "rejected") {
            summary.quality.historicalOrExpiredFiltered += 1;
            rejected.push({
              name: event.name,
              source: event.source,
              stage: "verification",
              reason: verification.reasons[0] ?? "Failed verification",
            });
            bump(event.source, "rejected");
            continue;
          }

          accepted.push({
            event,
            score: reviewOnlyScore(classified.reasons, verification.redFlags),
            fingerprint: "",
            status: "NEEDS_REVIEW",
            classification: classified.classification,
            sourceAuthority: sourceAuthority(event.source),
            deadlineState: deadlineStateFor(event, now),
            hasOfficialUrl: Boolean(event.officialUrl),
            hasApplyUrl: Boolean(event.applyUrl),
          });
          bump(event.source, "accepted");
          continue;
        }

        if (!shouldEnterNormalScoring(classified.classification)) {
          rejected.push({
            name: event.name,
            source: event.source,
            stage: "verification",
            reason: `Unsupported classification ${classified.classification}`,
          });
          bump(event.source, "rejected");
          continue;
        }

        summary.quality.individualEvents += 1;

        const verification = verifyHackathonEvent(event, { now });
        if (verification.status === "rejected") {
          if (/deadline|ended|stale title/i.test(verification.reasons.join(" "))) {
            summary.quality.historicalOrExpiredFiltered += 1;
          }
          rejected.push({
            name: event.name,
            source: event.source,
            stage: "verification",
            reason: verification.reasons[0] ?? "Failed verification",
          });
          bump(event.source, "rejected");
          continue;
        }

        const score = scoreHackathonEvent(event, preferences, { now });
        if (score.rejected) {
          rejected.push({
            name: event.name,
            source: event.source,
            stage: "scoring",
            reason: score.rejectionReason ?? "Rejected by eligibility/scoring",
          });
          bump(event.source, "rejected");
          continue;
        }

        if (!event.deadline) summary.quality.missingDeadlines += 1;
        if (!event.applyUrl) summary.quality.missingApplyLinks += 1;

        const status = verification.status === "needs_review" ? "NEEDS_REVIEW" : "NEW";
        accepted.push({
          event,
          score,
          fingerprint: "",
          status,
          classification: classified.classification,
          sourceAuthority: sourceAuthority(event.source),
          deadlineState: deadlineStateFor(event, now),
          hasOfficialUrl: Boolean(event.officialUrl),
          hasApplyUrl: Boolean(event.applyUrl),
        });
        bump(event.source, "accepted");
      } catch (error) {
        summary.errors.push(
          `${event.name}: ${error instanceof Error ? error.message : "processing failed"}`,
        );
      }
    }

    summary.accepted = accepted.length;
    summary.rejected = rejected.length;
    summary.rejectedCandidates = rejected;
    summary.needsReview = accepted.filter((item) => item.status === "NEEDS_REVIEW").length;

    assertNotCancelled(options.cancellationSignal);
    await emitter.emit("persistence_started", dryRun ? "Dry-run persistence…" : "Persisting candidates…");

    const seenFingerprints = new Set<string>();

    for (const item of accepted) {
      assertNotCancelled(options.cancellationSignal);
      const verification = verifyHackathonEvent(item.event, { now });
      const upsertInput = eventToUpsertInput(
        item.event,
        item.score,
        verification,
        item.status,
      );
      item.fingerprint = upsertInput.fingerprint;

      if (dryRun) {
        if (seenFingerprints.has(upsertInput.fingerprint)) {
          summary.wouldUpdate += 1;
          summary.duplicatesUpdated += 1;
        } else {
          seenFingerprints.add(upsertInput.fingerprint);
          summary.wouldCreate += 1;
          summary.stored += 1;
        }
        summary.wouldAttachEvidence += item.event.evidence.length;
        continue;
      }

      try {
        const result = await upsertCandidateByFingerprint(upsertInput);
        if (result.isNew) {
          summary.created += 1;
          summary.stored += 1;
        } else {
          summary.updated += 1;
          summary.duplicatesUpdated += 1;
        }

        for (const evidence of item.event.evidence) {
          try {
            await addEvidence(result.candidate.id, {
              ...eventEvidenceToAddInput(evidence),
              agentRunId,
            });
            summary.evidenceWritten += 1;
          } catch (error) {
            summary.storageFailures += 1;
            summary.warnings.push(
              `Evidence write failed for ${item.event.name}: ${
                error instanceof Error ? error.message : "unknown error"
              }`,
            );
          }
        }
      } catch (error) {
        summary.storageFailures += 1;
        summary.errors.push(
          `Upsert failed for ${item.event.name}: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }

    summary.acceptedCandidates = buildAcceptedSummary(accepted);
    summary.sourceStats = [...sourceStats.values()];
    summary.durationMs = Date.now() - startedAt;

    if (agentRunId) {
      const runStatus =
        summary.errors.length > 0
          ? summary.stored > 0
            ? "PARTIAL"
            : "FAILED"
          : "COMPLETED";
      await completeAgentRun(agentRunId, summary, runStatus);
    }

    const created = dryRun ? summary.wouldCreate : summary.created;
    const updated = dryRun ? summary.wouldUpdate : summary.updated;
    await emitter.emit(
      "run_completed",
      dryRun
        ? `Would create ${created}, would update ${updated}`
        : `${created} created, ${updated} updated`,
      {
        metadata: {
          rawLeads: summary.rawLeads,
          accepted: summary.accepted,
          rejected: summary.rejected,
          needsReview: summary.needsReview,
          created,
          updated,
          durationMs: summary.durationMs,
          dryRun,
        },
      },
    );

    return summary;
  } catch (error) {
    summary.errors.push(error instanceof Error ? error.message : "Discovery run failed");
    summary.sourceStats = [...sourceStats.values()];
    summary.durationMs = Date.now() - startedAt;

    if (isDiscoveryCancelledError(error)) {
      await emitter.emit("run_cancelled", "Discovery run cancelled", {
        level: "warning",
        metadata: { durationMs: summary.durationMs },
      });
    } else {
      await emitter.emit(
        "run_failed",
        error instanceof Error ? error.message : "Discovery run failed",
        {
          level: "error",
          metadata: { durationMs: summary.durationMs },
        },
      );
    }

    if (agentRunId) {
      try {
        await completeAgentRun(agentRunId, summary, "FAILED");
      } catch {
        // Ignore secondary failures while reporting the original error.
      }
    }

    throw error;
  }
}
