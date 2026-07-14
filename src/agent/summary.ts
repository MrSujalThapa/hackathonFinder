import type { CandidateStatus } from "@/lib/supabase/database.types";
import type { UpsertCandidateInput } from "@/core/candidates/types";
import { createCandidateFingerprint, sourceAuthority } from "@/core/dedupe";
import type { Json } from "@/lib/supabase/database.types";
import type {
  AcceptedCandidate,
  AgentRunSummary,
  DiscoveryPreferences,
  DiscoveryQualityStats,
  HackathonEvent,
  HackathonEvidence,
  ScoringResult,
  VerificationResult,
} from "@/core/discovery/types";
import type { EvidenceType } from "@/lib/supabase/database.types";
import type { AddEvidenceInput } from "@/core/candidates/types";
import { normalizeDatePart } from "@/core/dedupe";
import { deterministicCandidateSummary } from "@/core/candidateSummary";
import { formatPerformanceSummary } from "@/discovery/performance";

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
    summary: deterministicCandidateSummary(event, 280),
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

export function deadlineStateFor(
  event: HackathonEvent,
  now = new Date(),
): AcceptedCandidate["deadlineState"] {
  const deadline = normalizeDatePart(event.deadline);
  if (!deadline) return event.deadline ? "unclear" : "missing";
  const today = now.toISOString().slice(0, 10);
  return deadline < today ? "closed" : "open";
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
    classification: item.classification,
    sourceAuthority: item.sourceAuthority ?? sourceAuthority(item.event.source),
    deadlineState: item.deadlineState,
    hasOfficialUrl: item.hasOfficialUrl ?? Boolean(item.event.officialUrl),
    hasApplyUrl: item.hasApplyUrl ?? Boolean(item.event.applyUrl),
  }));
}

export function emptyQualityStats(): DiscoveryQualityStats {
  return {
    individualEvents: 0,
    directoriesFiltered: 0,
    articlesFiltered: 0,
    historicalOrExpiredFiltered: 0,
    uncertainNeedsReview: 0,
    crossSourceMerges: 0,
    missingDeadlines: 0,
    missingApplyLinks: 0,
  };
}

export function printAgentSummary(summary: AgentRunSummary): void {
  console.log("Hackathon Approval Agent");
  console.log("========================");
  console.log(`Raw command: ${summary.rawCommand}`);
  if (summary.dryRun) {
    console.log("[DRY RUN — NO DATABASE CHANGES]");
  } else {
    console.log("[LIVE MODE — WRITING TO SUPABASE]");
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
  if (summary.agent) {
    console.log(`- mode: ${summary.agent.mode}`);
    if (summary.agent.mode === "AGENT" && summary.agent.provider) {
      console.log(`- provider/model: ${summary.agent.provider}/${summary.agent.model ?? "(default)"}`);
    }
    console.log(`- agent tool calls: ${summary.agent.toolCalls}`);
    console.log(`- agent LLM calls: ${summary.agent.llmCalls}`);
    console.log(`- planning calls: ${summary.agent.planningCalls ?? 0}`);
    console.log(`- extraction calls: ${summary.agent.extractionCalls ?? 0}`);
    console.log(`- verification calls: ${summary.agent.verificationCalls ?? 0}`);
    console.log(`- summary calls: ${summary.agent.summaryCalls ?? 0}`);
    console.log(`- planner succeeded: ${summary.agent.plannerSucceeded ? "true" : "false"}`);
    console.log(`- fallback used: ${summary.agent.fallbackUsed ? "true" : "false"}`);
    if (summary.agent.plannerLatencyMs != null) {
      console.log(`- planner latency: ${summary.agent.plannerLatencyMs}ms`);
    }
    if (summary.agent.tokenUsage?.totalTokens != null) {
      console.log(`- planner tokens: ${summary.agent.tokenUsage.totalTokens}`);
    }
    console.log(`- stop reason: ${summary.agent.stopReason}`);
  }
  console.log(`- raw leads: ${summary.rawLeads}`);
  console.log(`- unique leads: ${summary.uniqueLeads}`);
  console.log(`- cross-source merges: ${summary.crossSourceMerges}`);
  console.log(`- enriched pages: ${summary.enriched}`);
  console.log(`- extracted: ${summary.extracted}`);
  console.log(`- accepted: ${summary.accepted}`);
  console.log(`- rejected: ${summary.rejected}`);
  console.log(`- needs review: ${summary.needsReview}`);

  if (summary.dryRun) {
    console.log(`- would create: ${summary.wouldCreate}`);
    console.log(`- would update: ${summary.wouldUpdate}`);
    console.log(`- would attach evidence: ${summary.wouldAttachEvidence}`);
    console.log("- stored: 0");
  } else {
    console.log(`- created: ${summary.created}`);
    console.log(`- updated: ${summary.updated}`);
    console.log(`- evidence written: ${summary.evidenceWritten}`);
    console.log(`- storage failures: ${summary.storageFailures}`);
  }

  console.log(`- duration: ${summary.durationMs}ms`);
  console.log("");

  console.log("Collection:");
  console.log(`- raw leads: ${summary.rawLeads}`);
  console.log(`- duplicate merges: ${summary.crossSourceMerges}`);
  console.log(`- unique events: ${summary.uniqueLeads}`);
  console.log("");

  console.log("Review:");
  console.log(`- ready for queue: ${summary.accepted - summary.needsReview}`);
  console.log(`- needs human review: ${summary.needsReview}`);
  console.log(`- invalid rejected: ${summary.rejected}`);
  console.log("");

  console.log("Persistence:");
  if (summary.dryRun) {
    console.log(`- would create: ${summary.wouldCreate}`);
    console.log(`- would update: ${summary.wouldUpdate}`);
    console.log(`- queue-visible: ${summary.wouldCreate + summary.wouldUpdate}`);
  } else {
    console.log(`- created: ${summary.created}`);
    console.log(`- updated: ${summary.updated}`);
    console.log(`- queue-visible: ${summary.created + summary.updated}`);
  }
  console.log("");

  console.log("Quality filters:");
  console.log(`- individual events: ${summary.quality.individualEvents}`);
  console.log(`- directories filtered: ${summary.quality.directoriesFiltered}`);
  console.log(`- articles filtered: ${summary.quality.articlesFiltered}`);
  console.log(
    `- historical/expired filtered: ${summary.quality.historicalOrExpiredFiltered}`,
  );
  console.log(`- uncertain/needs review: ${summary.quality.uncertainNeedsReview}`);
  console.log(`- cross-source merges: ${summary.quality.crossSourceMerges}`);
  console.log(`- missing deadlines: ${summary.quality.missingDeadlines}`);
  console.log(`- missing apply links: ${summary.quality.missingApplyLinks}`);
  console.log("");

  if (summary.xDiscovery) {
    const x = summary.xDiscovery;
    console.log("X discovery:");
    console.log(`- queries planned: ${x.queriesPlanned}`);
    console.log(`- queries executed: ${x.queriesExecuted}`);
    console.log(`- posts returned: ${x.postsReturned}`);
    console.log(`- posts deduped: ${x.postsDeduped}`);
    console.log(`- posts with links: ${x.postsWithLinks}`);
    console.log(`- posts kept: ${x.postsKept}`);
    console.log(`- rejected noise: ${x.postsRejectedNoise}`);
    console.log(`- pages enriched: ${x.pagesEnriched}`);
    console.log(`- rate/quota warnings: ${x.rateQuotaWarnings}`);
    console.log(`- X duration: ${x.durationMs}ms`);
    console.log("");
  }

  if (summary.sourceStats.length > 0) {
    console.log("Sources:");
    for (const stats of summary.sourceStats) {
      const outcome =
        stats.outcome === "degraded"
          ? "degraded"
          : stats.outcome === "failed"
            ? "failed"
            : stats.outcome === "auth_required"
              ? "auth required"
              : stats.outcome === "skipped"
                ? "skipped"
                : "";
      console.log(`- ${stats.source}:`);
      console.log(`  discovered: ${stats.leadsFound}`);
      console.log(`  queue-ready: ${stats.queueReady}`);
      console.log(`  needs review: ${stats.needsReview}`);
      console.log(`  invalid rejected: ${stats.invalidRejected}`);
      if (outcome) console.log(`  outcome: ${outcome}`);
      for (const warning of stats.warnings) {
        console.log(`  warning: ${warning}`);
      }
      for (const error of stats.errors) {
        console.log(`  error: ${error}`);
      }
    }
    console.log(
      `- executed sources: ${summary.sourceAccounting.executedSources.join(", ") || "(none)"}`,
    );
    console.log(
      `- skipped sources: ${summary.sourceAccounting.skippedSources.join(", ") || "(none)"}`,
    );
    console.log(
      `- failed sources: ${summary.sourceAccounting.failedSources.join(", ") || "(none)"}`,
    );
    console.log(
      `- degraded sources: ${summary.sourceAccounting.degradedSources.join(", ") || "(none)"}`,
    );
    console.log(
      `- auth-required sources: ${summary.sourceAccounting.authRequiredSources.join(", ") || "(none)"}`,
    );
    console.log("");
  }

  if (summary.acceptedCandidates.length > 0) {
    console.log("Accepted:");
    summary.acceptedCandidates.forEach((candidate, index) => {
      const base = `${index + 1}. ${candidate.name} — score ${candidate.score} — ${candidate.location} — deadline ${candidate.deadline}`;
      console.log(base);
      if (summary.verbose) {
        console.log(
          `   status=${candidate.status} classification=${candidate.classification ?? "n/a"} authority=${candidate.sourceAuthority ?? "n/a"} deadlineState=${candidate.deadlineState ?? "n/a"} official=${candidate.hasOfficialUrl ? "yes" : "no"} apply=${candidate.hasApplyUrl ? "yes" : "no"}`,
        );
      } else {
        console.log(
          `   ${candidate.classification ?? "EVENT"} · deadline ${candidate.deadlineState ?? "n/a"} · apply ${candidate.hasApplyUrl ? "yes" : "no"}`,
        );
      }
    });
    console.log("");
  }

  if (summary.rejectedCandidates.length > 0) {
    console.log("Rejected:");
    const rejected = summary.verbose
      ? summary.rejectedCandidates
      : summary.rejectedCandidates.slice(0, 25);
    for (const item of rejected) {
      console.log(`- ${item.name} — ${item.reason}`);
    }
    if (!summary.verbose && summary.rejectedCandidates.length > 25) {
      console.log(`- … ${summary.rejectedCandidates.length - 25} more (use --verbose)`);
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

  if (summary.performance) {
    for (const line of formatPerformanceSummary(summary.performance)) {
      console.log(line);
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
    verbose: false,
    rawLeads: 0,
    uniqueLeads: 0,
    crossSourceMerges: 0,
    enriched: 0,
    extracted: 0,
    accepted: 0,
    rejected: 0,
    created: 0,
    updated: 0,
    wouldCreate: 0,
    wouldUpdate: 0,
    evidenceWritten: 0,
    wouldAttachEvidence: 0,
    storageFailures: 0,
    stored: 0,
    duplicatesUpdated: 0,
    needsReview: 0,
    durationMs: 0,
    quality: emptyQualityStats(),
    acceptedCandidates: [],
    rejectedCandidates: [],
    sourceStats: [],
    sourceAccounting: {
      executedSources: [],
      skippedSources: [],
      failedSources: [],
      degradedSources: [],
      authRequiredSources: [],
    },
    warnings: [],
    errors: [],
  };
}
