import type { Json } from "@/lib/supabase/database.types";
import { mockCollector } from "@/collectors/mock";
import { hasSupabaseConfig, getServerEnv } from "@/config/env";
import type {
  AcceptedCandidate,
  AgentRunSummary,
  DiscoveryPreferences,
  RejectedCandidate,
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

export async function runDiscovery(
  preferences: DiscoveryPreferences,
  dryRun: boolean,
): Promise<AgentRunSummary> {
  const startedAt = Date.now();
  const summary = emptySummary(preferences.rawCommand, preferences, dryRun);

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
    const leads = await mockCollector.collect(preferences);
    summary.rawLeads = leads.length;

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
          continue;
        }

        const status = verification.status === "needs_review" ? "NEEDS_REVIEW" : "NEW";
        accepted.push({ event, score, fingerprint: "", status });
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
