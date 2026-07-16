import type { DiscoveryJob } from "@/jobs/types";

/** Compact job projection for SSE end / JSON poll — no heavy nested dumps. */
export function compactJobForPoll(job: DiscoveryJob): Record<string, unknown> {
  const summary = job.summary ?? {};
  return {
    id: job.id,
    status: job.status,
    dryRun: job.dryRun,
    progress: job.progress,
    currentStage: job.currentStage,
    createdCount: job.createdCount,
    updatedCount: job.updatedCount,
    acceptedCount: job.acceptedCount,
    rejectedCount: job.rejectedCount,
    needsReviewCount: job.needsReviewCount,
    rawLeadsCount: job.rawLeadsCount,
    durationMs: job.durationMs,
    safeErrorMessage: job.safeErrorMessage,
    completedAt: job.completedAt,
    summary: {
      dryRun: summary.dryRun ?? job.dryRun,
      profile: summary.profile ?? null,
      rawLeads: summary.rawLeads ?? job.rawLeadsCount,
      uniqueLeads: summary.uniqueLeads ?? null,
      accepted: summary.accepted ?? job.acceptedCount,
      queueReady: summary.queueReady ?? null,
      rejected: summary.rejected ?? job.rejectedCount,
      needsReview: summary.needsReview ?? job.needsReviewCount,
      created: summary.created ?? job.createdCount,
      updated: summary.updated ?? job.updatedCount,
      durationMs: summary.durationMs ?? job.durationMs,
      sourceAccounting: summary.sourceAccounting ?? null,
      acceptedCandidates: Array.isArray(summary.acceptedCandidates)
        ? summary.acceptedCandidates
        : [],
      warnings: Array.isArray(summary.warnings) ? summary.warnings.slice(0, 20) : [],
      errors: Array.isArray(summary.errors) ? summary.errors.slice(0, 10) : [],
    },
  };
}
