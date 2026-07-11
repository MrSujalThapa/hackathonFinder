import { hasGoogleSheetsConfig } from "@/config/env";
import type { AddActionInput, CandidateCard, CandidateDetail } from "@/core/candidates/types";
import { getGoogleSheetsConfig } from "@/lib/google/config";
import type { GoogleSheetsConfig } from "@/lib/google/types";
import { GoogleSheetsError } from "@/lib/google/types";
import type { Json } from "@/lib/supabase/database.types";
import {
  getCandidateRepository,
  isMockCandidatesEnabled,
} from "@/server/candidates/service";
import {
  appendApprovedCandidate,
  type AppendDeps,
} from "@/server/sheets/appendApprovedCandidate";
import {
  deleteRowByCandidateId,
  type DeleteRowDeps,
} from "@/server/sheets/deleteRowByCandidateId";
import type {
  SheetReconcileDirection,
  SheetReconcileResult,
  SheetReconcileStatus,
  SheetSyncResult,
} from "@/server/sheets/types";

export type ReconcileDeps = {
  getCandidate: (id: string) => Promise<CandidateDetail | null>;
  clearSheetMetadata: (id: string) => Promise<CandidateCard>;
  addAction: (candidateId: string, action: AddActionInput) => Promise<unknown>;
  isMockCandidatesEnabled: () => boolean;
  hasGoogleSheetsConfig: () => boolean;
  getGoogleSheetsConfig: () => GoogleSheetsConfig;
  appendApprovedCandidate: (
    candidateId: string,
    depsOverrides?: Partial<AppendDeps>,
  ) => Promise<SheetSyncResult>;
  deleteRowByCandidateId: (
    candidateId: string,
    depsOverrides?: Partial<DeleteRowDeps>,
  ) => Promise<Awaited<ReturnType<typeof deleteRowByCandidateId>>>;
  /** Forwarded into deleteRowByCandidateId when provided. */
  deleteRowDeps?: Partial<DeleteRowDeps>;
  /** Forwarded into appendApprovedCandidate when provided. */
  appendDeps?: Partial<AppendDeps>;
};

function resolveDeps(overrides?: Partial<ReconcileDeps>): ReconcileDeps {
  const repo = getCandidateRepository();

  return {
    getCandidate: (id) => repo.getCandidate(id),
    clearSheetMetadata: (id) => {
      if (!repo.clearSheetMetadata) {
        throw new Error("Candidate repository does not support clearSheetMetadata");
      }
      return repo.clearSheetMetadata(id);
    },
    addAction: async (candidateId, action) => {
      if (!repo.addAction) {
        throw new Error("Candidate repository does not support addAction");
      }
      return repo.addAction(candidateId, action);
    },
    isMockCandidatesEnabled,
    hasGoogleSheetsConfig,
    getGoogleSheetsConfig,
    appendApprovedCandidate,
    deleteRowByCandidateId,
    ...overrides,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof GoogleSheetsError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function mapAppendStatus(result: SheetSyncResult): SheetReconcileStatus {
  switch (result.status) {
    case "appended":
      return "appended";
    case "already_synced":
      return "already_present";
    case "recovered_existing_row":
      return "recovered_existing_row";
    case "mock_synced":
      return "mock_synced";
    case "skipped_not_configured":
      return "skipped_not_configured";
    case "failed":
      return "failed";
    case "skipped_not_approved":
      return "failed";
    case "dry_run":
      return "failed";
    default:
      return "failed";
  }
}

async function recordSheetDeleteAction(
  deps: ReconcileDeps,
  candidateId: string,
  metadata: Json,
): Promise<void> {
  await deps.addAction(candidateId, {
    action: "SHEET_DELETE",
    metadata,
  });
}

async function ensurePresent(
  candidateId: string,
  deps: ReconcileDeps,
): Promise<SheetReconcileResult> {
  const direction: SheetReconcileDirection = "ensure_present";
  const result = await deps.appendApprovedCandidate(
    candidateId,
    deps.appendDeps,
  );

  return {
    status: mapAppendStatus(result),
    candidateId,
    direction,
    rowId: result.rowId,
    message: result.message,
  };
}

async function ensureAbsent(
  candidate: CandidateDetail,
  deps: ReconcileDeps,
): Promise<SheetReconcileResult> {
  const direction: SheetReconcileDirection = "ensure_absent";
  const candidateId = candidate.id;
  const hadMetadata = Boolean(candidate.sheetRowId || candidate.sheetAppendedAt);

  if (deps.isMockCandidatesEnabled()) {
    if (!hadMetadata) {
      return {
        status: "already_absent",
        candidateId,
        direction,
        metadataCleared: false,
      };
    }
    try {
      await deps.clearSheetMetadata(candidateId);
      await recordSheetDeleteAction(deps, candidateId, {
        ok: true,
        mock: true,
      });
    } catch (error) {
      return {
        status: "failed",
        candidateId,
        direction,
        message: errorMessage(error),
      };
    }
    return {
      status: "mock_cleared",
      candidateId,
      direction,
      metadataCleared: true,
    };
  }

  if (!deps.hasGoogleSheetsConfig()) {
    if (hadMetadata) {
      try {
        await deps.clearSheetMetadata(candidateId);
      } catch (error) {
        return {
          status: "failed",
          candidateId,
          direction,
          message: errorMessage(error),
        };
      }
      return {
        status: "skipped_not_configured",
        candidateId,
        direction,
        metadataCleared: true,
        message: "Google Sheets is not configured; cleared stale metadata",
      };
    }
    return {
      status: "skipped_not_configured",
      candidateId,
      direction,
      metadataCleared: false,
      message: "Google Sheets is not configured",
    };
  }

  const deleteResult = await deps.deleteRowByCandidateId(
    candidateId,
    deps.deleteRowDeps,
  );

  if (deleteResult.status === "failed") {
    await recordSheetDeleteAction(deps, candidateId, {
      ok: false,
      error: deleteResult.message ?? "delete failed",
      phase: "delete",
      rowNumber: deleteResult.rowNumber ?? null,
      range: deleteResult.range ?? null,
    }).catch(() => undefined);
    return {
      status: "failed",
      candidateId,
      direction,
      rowId: deleteResult.range,
      rowNumber: deleteResult.rowNumber,
      message: deleteResult.message,
    };
  }

  if (deleteResult.status === "already_absent") {
    if (hadMetadata) {
      try {
        await deps.clearSheetMetadata(candidateId);
      } catch (error) {
        return {
          status: "failed",
          candidateId,
          direction,
          message: `Sheet row already absent but metadata clear failed: ${errorMessage(error)}`,
        };
      }
      await recordSheetDeleteAction(deps, candidateId, {
        ok: true,
        alreadyAbsent: true,
        clearedStaleMetadata: true,
      }).catch(() => undefined);
      return {
        status: "already_absent",
        candidateId,
        direction,
        metadataCleared: true,
      };
    }
    return {
      status: "already_absent",
      candidateId,
      direction,
      metadataCleared: false,
    };
  }

  // deleted
  try {
    await deps.clearSheetMetadata(candidateId);
  } catch (error) {
    const message = errorMessage(error);
    await recordSheetDeleteAction(deps, candidateId, {
      ok: false,
      error: message,
      phase: "metadata_after_delete",
      deleteSucceeded: true,
      rowNumber: deleteResult.rowNumber ?? null,
      range: deleteResult.range ?? null,
    }).catch(() => undefined);
    return {
      status: "failed",
      candidateId,
      direction,
      rowId: deleteResult.range,
      rowNumber: deleteResult.rowNumber,
      message: `Sheet row deleted but metadata clear failed (retry will confirm absence via Candidate ID lookup): ${message}`,
    };
  }

  await recordSheetDeleteAction(deps, candidateId, {
    ok: true,
    rowNumber: deleteResult.rowNumber ?? null,
    range: deleteResult.range ?? null,
  });

  return {
    status: "deleted",
    candidateId,
    direction,
    rowId: deleteResult.range,
    rowNumber: deleteResult.rowNumber,
    metadataCleared: true,
  };
}

/**
 * Bidirectional Google Sheet reconciliation for a candidate.
 *
 * - APPROVED → ensure present (delegates to appendApprovedCandidate)
 * - otherwise → ensure absent (find by Candidate ID, DeleteDimension, clear metadata)
 *
 * Callers should catch and treat `failed` as non-fatal for status changes.
 */
export async function reconcileCandidateSheetState(
  candidateId: string,
  depsOverrides?: Partial<ReconcileDeps>,
): Promise<SheetReconcileResult> {
  const deps = resolveDeps(depsOverrides);

  let candidate: CandidateDetail | null;
  try {
    candidate = await deps.getCandidate(candidateId);
  } catch (error) {
    return {
      status: "failed",
      candidateId,
      direction: "ensure_absent",
      message: errorMessage(error),
    };
  }

  if (!candidate) {
    return {
      status: "failed",
      candidateId,
      direction: "ensure_absent",
      message: `Candidate not found: ${candidateId}`,
    };
  }

  if (candidate.status === "APPROVED") {
    return ensurePresent(candidateId, deps);
  }

  return ensureAbsent(candidate, deps);
}
