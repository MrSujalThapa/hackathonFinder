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
import { extractHackathonEvents } from "@/core/extract";
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

const SUPABASE_ENV_MESSAGE =
  "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env.local, or run with --dry-run.";

const MOCK_WRITE_REFUSED_MESSAGE =
  'Refusing to upsert mock-sourced candidates into the live database while USE_MOCK_CANDIDATES=false. Re-run with --dry-run, set USE_MOCK_CANDIDATES=true for local fixtures, or pass --allow-mock-writes to override.';

export type RunDiscoveryOptions = {
  allowMockWrites?: boolean;
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
    const collectorResults = await runCollectors(
      {
        preferences,
        maxResults: preferences.maxResults,
        timeoutMs: DEFAULT_COLLECTOR_TIMEOUT_MS,
        dryRun,
        requestId: runId ?? undefined,
      },
      preferences.sources,
    );

    const leads = collectorResults.flatMap((result) => result.leads);
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

    const events = extractHackathonEvents(leads);
    summary.extracted = events.length;

    const accepted: AcceptedCandidate[] = [];
    const rejected: RejectedCandidate[] = [];

    for (const event of events) {
      try {
        const verification = verifyHackathonEvent(event);
        if (verification.status === "rejected") {
          rejected.push({
            name: event.name,
            source: event.source,
            stage: "verification",
            reason: verification.reasons[0] ?? "Failed verification",
          });
          sourceStats.get(event.source)!.rejected += 1;
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
          sourceStats.get(event.source)!.rejected += 1;
          continue;
        }

        const status = verification.status === "needs_review" ? "NEEDS_REVIEW" : "NEW";
        accepted.push({ event, score, fingerprint: "", status });
        sourceStats.get(event.source)!.accepted += 1;
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
          await addEvidence(result.candidate.id, eventEvidenceToAddInput(evidence));
        }
      } catch (error) {
        summary.errors.push(
          `${item.event.name}: ${error instanceof Error ? error.message : "storage failed"}`,
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
