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
  showXPlan?: boolean;
  dryRunPlan?: boolean;
  verbose?: boolean;
  now?: Date;
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
  const now = options.now ?? new Date();
  summary.verbose = options.verbose === true;

  if (options.showSearchPlan || options.dryRunPlan) {
    const queries = planSearchQueries(preferences);
    console.log("Search plan:");
    console.log(formatSearchPlan(queries));
    console.log("");
  }

  if (options.showXPlan || (options.dryRunPlan && preferences.sources.includes("x"))) {
    const xQueries = planXQueries(preferences);
    console.log("X plan:");
    console.log(formatXPlan(xQueries));
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

    const extracted = extractHackathonEvents(leads, { now });
    const merged = mergeCrossSourceEvents(extracted);
    summary.extracted = extracted.length;
    summary.uniqueLeads = merged.events.length;
    summary.crossSourceMerges = merged.mergeCount;
    summary.quality.crossSourceMerges = merged.mergeCount;

    const accepted: AcceptedCandidate[] = [];
    const rejected: RejectedCandidate[] = [];

    const bump = (source: SourceName, field: "accepted" | "rejected") => {
      const stats = sourceStats.get(source);
      if (stats) stats[field] += 1;
    };

    for (const event of merged.events) {
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

          accepted.push({
            event,
            score,
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

    const seenFingerprints = new Set<string>();

    for (const item of accepted) {
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
            await addEvidence(result.candidate.id, eventEvidenceToAddInput(evidence));
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
