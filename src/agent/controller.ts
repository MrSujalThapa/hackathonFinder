import type { Json } from "@/lib/supabase/database.types";
import { runCollectors } from "@/collectors/registry";
import { DEFAULT_COLLECTOR_TIMEOUT_MS } from "@/collectors/types";
import { hasSupabaseConfig, getServerEnv } from "@/config/env";
import type {
  AcceptedCandidate,
  AgentRunSummary,
  DiscoveryPreferences,
  RejectedCandidate,
  SourceName,
  SourceRunStats,
} from "@/core/discovery/types";
import { enrichPromisingLeads } from "@/core/enrichLead";
import { extractHackathonEvents } from "@/core/extract";
import { mergeCrossSourceEvents } from "@/core/mergeEvents";
import { scoreHackathonEvent } from "@/core/score";
import { verifyHackathonEvent } from "@/core/verify";
import { addEvidence, upsertCandidateByFingerprint } from "@/server/candidates/repository";
import { completeAgentRun, createAgentRun } from "@/server/agent/runs";
import {
  buildAcceptedSummary,
  emptySummary,
  eventEvidenceToAddInput,
  eventToUpsertInput,
} from "@/agent/summary";
import { formatSearchPlan, planSearchQueries } from "@/agent/planSearchQueries";

const SUPABASE_ENV_MESSAGE =
  "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env.local, or run with --dry-run.";

const MOCK_WRITE_REFUSED_MESSAGE =
  'Refusing to upsert mock-sourced candidates into the live database while USE_MOCK_CANDIDATES=false. Re-run with --dry-run, set USE_MOCK_CANDIDATES=true for local fixtures, or pass --allow-mock-writes to override.';

const DEFAULT_TOTAL_TIMEOUT_MS = 45_000;

export type RunDiscoveryOptions = {
  allowMockWrites?: boolean;
  sourceTimeoutMs?: number;
  totalTimeoutMs?: number;
  showSearchPlan?: boolean;
  dryRunPlan?: boolean;
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

export async function runDiscovery(
  preferences: DiscoveryPreferences,
  dryRun: boolean,
  options: RunDiscoveryOptions = {},
): Promise<AgentRunSummary> {
  const startedAt = Date.now();
  const summary = emptySummary(preferences.rawCommand, preferences, dryRun);
  const sourceStats = initSourceStats(preferences.sources);
  const allowMockWrites = options.allowMockWrites === true;
  const sourceTimeoutMs = options.sourceTimeoutMs ?? DEFAULT_COLLECTOR_TIMEOUT_MS;
  const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const effectiveSourceTimeout = Math.min(sourceTimeoutMs, totalTimeoutMs);

  if (options.showSearchPlan || options.dryRunPlan) {
    const queries = planSearchQueries(preferences);
    console.log("Search plan:");
    console.log(formatSearchPlan(queries));
    console.log("");
  }

  if (options.dryRunPlan) {
    summary.warnings.push("Dry-run plan only; collectors were not executed.");
    summary.durationMs = Date.now() - startedAt;
    summary.sourceStats = [...sourceStats.values()];
    return summary;
  }

  assertMockWritesAllowed(preferences, dryRun, allowMockWrites);

  if (!dryRun && !hasSupabaseConfig(getServerEnv())) {
    throw new Error(SUPABASE_ENV_MESSAGE);
  }

  let runId: string | null = null;

  if (!dryRun) {
    try {
      runId = await createAgentRun({
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
    const collectorPromise = runCollectors(
      {
        preferences,
        maxResults: preferences.maxResults,
        timeoutMs: effectiveSourceTimeout,
        dryRun,
        requestId: runId ?? undefined,
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
      // Total budget hit: still await collectors but warn; do not block forever beyond a short grace.
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

    if (timedOut && collectorResults.length === 0) {
      summary.warnings.push("Collectors returned no results before the total timeout grace period ended.");
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
      summary.warnings.push(...result.warnings.map((warning) => `[${result.source}] ${warning}`));
      summary.errors.push(...result.errors.map((error) => `[${result.source}] ${error}`));
    }

    const enrichment = await enrichPromisingLeads(leads, {
      timeoutMs: Math.min(10_000, effectiveSourceTimeout),
      maxPages: 15,
      concurrency: 4,
    });
    leads = enrichment.leads;
    summary.enriched = enrichment.enrichedCount;
    summary.warnings.push(...enrichment.warnings.map((warning) => `[enrich] ${warning}`));

    const extracted = extractHackathonEvents(leads);
    const merged = mergeCrossSourceEvents(extracted);
    summary.extracted = extracted.length;
    summary.uniqueLeads = merged.events.length;
    summary.crossSourceMerges = merged.mergeCount;

    const accepted: AcceptedCandidate[] = [];
    const rejected: RejectedCandidate[] = [];

    const bump = (source: SourceName, field: "accepted" | "rejected") => {
      const stats = sourceStats.get(source);
      if (stats) stats[field] += 1;
    };

    for (const event of merged.events) {
      try {
        const verification = verifyHackathonEvent(event);
        if (verification.status === "rejected") {
          rejected.push({
            name: event.name,
            source: event.source,
            stage: "verification",
            reason: verification.reasons[0] ?? "Failed verification",
          });
          bump(event.source, "rejected");
          continue;
        }

        const score = scoreHackathonEvent(event, preferences);
        if (score.rejected) {
          rejected.push({
            name: event.name,
            source: event.source,
            stage: "scoring",
            reason: score.rejectionReason ?? "Rejected by scoring rules",
          });
          bump(event.source, "rejected");
          continue;
        }

        const status = verification.status === "needs_review" ? "NEEDS_REVIEW" : "NEW";
        accepted.push({ event, score, fingerprint: "", status });
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

    const seenFingerprints = new Set<string>();

    for (const item of accepted) {
      const verification = verifyHackathonEvent(item.event);
      const upsertInput = eventToUpsertInput(
        item.event,
        item.score,
        verification,
        item.status,
      );
      item.fingerprint = upsertInput.fingerprint;

      if (dryRun) {
        if (seenFingerprints.has(upsertInput.fingerprint)) {
          summary.duplicatesUpdated += 1;
        } else {
          seenFingerprints.add(upsertInput.fingerprint);
          summary.stored += 1;
        }
        continue;
      }

      try {
        const result = await upsertCandidateByFingerprint(upsertInput);
        if (result.isNew) {
          summary.stored += 1;
        } else {
          summary.duplicatesUpdated += 1;
        }

        for (const evidence of item.event.evidence) {
          try {
            await addEvidence(result.candidate.id, eventEvidenceToAddInput(evidence));
          } catch (error) {
            summary.warnings.push(
              `Evidence write failed for ${item.event.name}: ${
                error instanceof Error ? error.message : "unknown error"
              }`,
            );
          }
        }
      } catch (error) {
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

    if (runId) {
      const runStatus =
        summary.errors.length > 0
          ? summary.stored > 0
            ? "PARTIAL"
            : "FAILED"
          : "COMPLETED";
      await completeAgentRun(runId, summary, runStatus);
    }

    return summary;
  } catch (error) {
    summary.errors.push(error instanceof Error ? error.message : "Discovery run failed");
    summary.sourceStats = [...sourceStats.values()];
    summary.durationMs = Date.now() - startedAt;

    if (runId) {
      try {
        await completeAgentRun(runId, summary, "FAILED");
      } catch {
        // Ignore secondary failures while reporting the original error.
      }
    }

    throw error;
  }
}
