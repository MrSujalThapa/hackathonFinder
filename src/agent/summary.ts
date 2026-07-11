import type { CandidateStatus } from "@/lib/supabase/database.types";
import type { UpsertCandidateInput } from "@/core/candidates/types";
import { createCandidateFingerprint } from "@/core/dedupe";
import type { Json } from "@/lib/supabase/database.types";
import type {
  AcceptedCandidate,
  AgentRunSummary,
  DiscoveryPreferences,
  HackathonEvent,
  HackathonEvidence,
  ScoringResult,
  VerificationResult,
} from "@/core/discovery/types";
import type { EvidenceType } from "@/lib/supabase/database.types";
import type { AddEvidenceInput } from "@/core/candidates/types";

export function mapEvidenceType(type: HackathonEvidence["type"]): EvidenceType {
  switch (type) {
    case "official_page":
    case "apply_page":
    case "x_post":
    case "manual_lead":
    case "search_result":
    case "source_card":
      return type;
    default:
      return "source_card";
  }
}

export function eventToUpsertInput(
  event: HackathonEvent,
  score: ScoringResult,
  verification: VerificationResult,
  status: CandidateStatus,
): UpsertCandidateInput {
  const fingerprint = createCandidateFingerprint({
    name: event.name,
    officialUrl: event.officialUrl,
    applyUrl: event.applyUrl,
    socialUrl: event.socialUrl,
    city: event.city,
    country: event.country,
    mode: event.mode,
    startDate: event.startDate,
    deadline: event.deadline,
    sourceIds: event.sourceIds,
  });

  const redFlags = [...new Set([...score.redFlags, ...verification.redFlags])];

  return {
    fingerprint,
    name: event.name,
    source: event.source,
    status,
    score: score.score,
    officialUrl: event.officialUrl ?? null,
    applyUrl: event.applyUrl ?? null,
    socialUrl: event.socialUrl ?? null,
    startDate: event.startDate ?? null,
    endDate: event.endDate ?? null,
    deadline: event.deadline ?? null,
    location: event.location ?? null,
    mode: event.mode ?? null,
    city: event.city ?? null,
    country: event.country ?? null,
    prize: event.prize ?? null,
    themes: event.themes,
    eligibility: event.eligibility ?? null,
    description: event.description ?? null,
    summary: event.description?.slice(0, 280) ?? null,
    whyMatch: score.whyMatch,
    redFlags,
    sourceIds: event.sourceIds ?? {},
  };
}

export function eventEvidenceToAddInput(
  evidence: HackathonEvidence,
): AddEvidenceInput {
  return {
    type: mapEvidenceType(evidence.type),
    url: evidence.url ?? null,
    title: evidence.title ?? null,
    snippet: evidence.snippet ?? null,
    raw: (evidence.raw ?? {}) as Json,
  };
}

export function formatLocation(event: HackathonEvent): string {
  if (event.mode === "online" || event.city === "Remote") {
    return "Online";
  }

  return [event.city, event.country].filter(Boolean).join(", ") || event.location || "Unknown";
}

export function buildAcceptedSummary(
  accepted: AcceptedCandidate[],
): AgentRunSummary["acceptedCandidates"] {
  return accepted.map((item) => ({
    name: item.event.name,
    score: item.score.score,
    location: formatLocation(item.event),
    deadline: item.event.deadline ?? item.event.startDate ?? "unclear",
    status: item.status,
  }));
}

export function printAgentSummary(summary: AgentRunSummary): void {
  console.log("Hackathon Approval Agent");
  console.log("========================");
  console.log(`Raw command: ${summary.rawCommand}`);
  if (summary.dryRun) {
    console.log("Mode: dry-run (no database writes)");
  }
  console.log("");

  console.log("Parsed command:");
  console.log(`- locations: ${summary.preferences.locations.join(", ")}`);
  console.log(`- themes: ${summary.preferences.themes.join(", ")}`);
  if (summary.preferences.dateFrom || summary.preferences.dateTo) {
    const range =
      summary.preferences.dateFrom && summary.preferences.dateTo
        ? `${summary.preferences.dateFrom} to ${summary.preferences.dateTo}`
        : summary.preferences.dateFrom
          ? `from ${summary.preferences.dateFrom}`
          : "upcoming";
    console.log(`- date range: ${range}`);
  } else {
    console.log("- date range: upcoming");
  }
  console.log(`- sources: ${summary.preferences.sources.join(", ")}`);
  console.log("");

  console.log("Discovery summary:");
  console.log(`- raw leads: ${summary.rawLeads}`);
  console.log(`- extracted: ${summary.extracted}`);
  console.log(`- accepted: ${summary.accepted}`);
  console.log(`- rejected: ${summary.rejected}`);
  console.log(`- stored: ${summary.stored}`);
  console.log(`- duplicates/updates: ${summary.duplicatesUpdated}`);
  console.log(`- needs review: ${summary.needsReview}`);
  console.log(`- duration: ${summary.durationMs}ms`);
  console.log("");

  if (summary.sourceStats.length > 0) {
    console.log("Source stats:");
    for (const stats of summary.sourceStats) {
      console.log(
        `- ${stats.source}: leads ${stats.leadsFound}, accepted ${stats.accepted}, rejected ${stats.rejected}, duration ${stats.durationMs}ms`,
      );
      for (const warning of stats.warnings) {
        console.log(`  warning: ${warning}`);
      }
      for (const error of stats.errors) {
        console.log(`  error: ${error}`);
      }
    }
    console.log("");
  }

  if (summary.acceptedCandidates.length > 0) {
    console.log("Accepted:");
    summary.acceptedCandidates.forEach((candidate, index) => {
      console.log(
        `${index + 1}. ${candidate.name} — score ${candidate.score} — ${candidate.location} — deadline ${candidate.deadline}`,
      );
    });
    console.log("");
  }

  if (summary.rejectedCandidates.length > 0) {
    console.log("Rejected:");
    for (const rejected of summary.rejectedCandidates) {
      console.log(`- ${rejected.name} — ${rejected.reason}`);
    }
    console.log("");
  }

  if (summary.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of summary.warnings) {
      console.log(`- ${warning}`);
    }
    console.log("");
  }

  if (summary.errors.length > 0) {
    console.log("Errors:");
    for (const error of summary.errors) {
      console.log(`- ${error}`);
    }
    console.log("");
  }
}

export function emptySummary(
  rawCommand: string,
  preferences: DiscoveryPreferences,
  dryRun: boolean,
): AgentRunSummary {
  return {
    rawCommand,
    preferences,
    dryRun,
    rawLeads: 0,
    extracted: 0,
    accepted: 0,
    rejected: 0,
    stored: 0,
    duplicatesUpdated: 0,
    needsReview: 0,
    durationMs: 0,
    acceptedCandidates: [],
    rejectedCandidates: [],
    sourceStats: [],
    warnings: [],
    errors: [],
  };
}
