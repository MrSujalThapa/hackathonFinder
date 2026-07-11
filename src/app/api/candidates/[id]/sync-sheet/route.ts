import {
  candidateIdSchema,
  fail,
  ok,
  validationError,
} from "@/server/api/envelope";
import { getCandidateRepository } from "@/server/candidates/service";
import { timedAsync } from "@/lib/perf/timing";
import { reconcileCandidateSheetState } from "@/server/sheets/reconcileCandidateSheetState";
import type {
  SheetReconcileResult,
  SheetSyncResult,
  SheetSyncStatus,
} from "@/server/sheets/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function toSheetSyncResult(result: SheetReconcileResult): SheetSyncResult {
  const statusMap: Record<string, SheetSyncStatus> = {
    appended: "appended",
    already_present: "already_synced",
    already_synced: "already_synced",
    recovered_existing_row: "recovered_existing_row",
    deleted: "deleted",
    already_absent: "already_absent",
    failed: "failed",
    mock_synced: "mock_synced",
    mock_cleared: "mock_cleared",
    skipped_not_configured: "skipped_not_configured",
  };

  return {
    status: statusMap[result.status] ?? "failed",
    candidateId: result.candidateId,
    rowId: result.rowId,
    message: result.message,
  };
}

/**
 * Idempotent Sheet reconciliation for any candidate status.
 * APPROVED → ensure row present; otherwise → ensure row absent (DeleteDimension).
 */
export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { id } = await context.params;
    const parsedId = candidateIdSchema.safeParse(id);
    if (!parsedId.success) {
      return validationError(parsedId.error);
    }

    const repo = getCandidateRepository();
    const existing = await repo.getCandidate(parsedId.data);
    if (!existing) {
      return fail("CANDIDATE_NOT_FOUND", "Candidate not found", 404);
    }

    const reconcile = await timedAsync("server.sheets_reconcile", () =>
      reconcileCandidateSheetState(parsedId.data),
    );
    const candidate = await repo.getCandidate(parsedId.data);

    return ok({
      candidate,
      sheetSync: toSheetSyncResult(reconcile),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to sync candidate to sheet";
    return fail("INTERNAL_ERROR", message, 500);
  }
}
