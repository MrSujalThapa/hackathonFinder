import type { CandidateCard } from "@/core/candidates/types";
import { getCandidateRepository } from "@/server/candidates/service";
import { appendApprovedCandidate } from "@/server/sheets/appendApprovedCandidate";
import type { BatchSyncSummary, SheetSyncResult } from "@/server/sheets/types";

function needsSheetSync(candidate: CandidateCard): boolean {
  return !candidate.sheetRowId || !candidate.sheetAppendedAt;
}

function emptySummary(): BatchSyncSummary {
  return {
    checked: 0,
    appended: 0,
    already_synced: 0,
    recovered: 0,
    skipped: 0,
    failed: 0,
    mock_synced: 0,
    dry_run: 0,
    results: [],
  };
}

function tally(summary: BatchSyncSummary, result: SheetSyncResult): void {
  summary.results.push(result);
  switch (result.status) {
    case "appended":
      summary.appended += 1;
      break;
    case "already_synced":
      summary.already_synced += 1;
      break;
    case "recovered_existing_row":
      summary.recovered += 1;
      break;
    case "mock_synced":
      summary.mock_synced += 1;
      break;
    case "dry_run":
      summary.dry_run += 1;
      break;
    case "failed":
      summary.failed += 1;
      break;
    case "skipped_not_approved":
    case "skipped_not_configured":
      summary.skipped += 1;
      break;
    default:
      summary.skipped += 1;
      break;
  }
}

async function loadPending(limit: number): Promise<CandidateCard[]> {
  const repo = getCandidateRepository();
  if (repo.listPendingSheetSync) {
    return repo.listPendingSheetSync(limit);
  }

  // Test fakes may omit listPendingSheetSync.
  const { candidates } = await repo.listCandidates({
    status: "APPROVED",
    limit,
    sort: "found_at",
  });
  return candidates.filter(needsSheetSync);
}

/**
 * Batch-recover APPROVED candidates that are missing sheet sync metadata.
 * Continues on per-candidate errors.
 */
export async function syncPendingApproved(options: {
  limit?: number;
  dryRun?: boolean;
} = {}): Promise<BatchSyncSummary> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const dryRun = options.dryRun ?? false;
  const summary = emptySummary();

  const pending = await loadPending(limit);
  summary.checked = pending.length;

  if (dryRun) {
    for (const candidate of pending) {
      tally(summary, {
        candidateId: candidate.id,
        status: "dry_run",
        message: `dry-run: would sync "${candidate.name}"`,
      });
    }
    return summary;
  }

  for (const candidate of pending) {
    try {
      const result = await appendApprovedCandidate(candidate.id);
      tally(summary, result);
    } catch (error) {
      tally(summary, {
        status: "failed",
        candidateId: candidate.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summary;
}
