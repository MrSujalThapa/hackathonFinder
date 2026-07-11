import { hasGoogleSheetsConfig } from "@/config/env";
import type { AddActionInput, CandidateCard, CandidateDetail } from "@/core/candidates/types";
import { getGoogleSheetsConfig } from "@/lib/google/config";
import {
  appendRow,
  findRowByCandidateId,
  type SheetsApi,
} from "@/lib/google/sheetsClient";
import type { FindRowResult, GoogleSheetsConfig } from "@/lib/google/types";
import { GoogleSheetsError } from "@/lib/google/types";
import type { Json } from "@/lib/supabase/database.types";
import {
  getCandidateRepository,
  isMockCandidatesEnabled,
} from "@/server/candidates/service";
import { mapCandidateRow } from "@/server/sheets/mapCandidateRow";
import {
  CANDIDATE_ID_COLUMN_INDEX,
  ensureHeaders,
} from "@/server/sheets/schema";
import type { SheetSyncResult } from "@/server/sheets/types";

export type AppendDeps = {
  getCandidate: (id: string) => Promise<CandidateDetail | null>;
  updateSheetMetadata: (
    id: string,
    meta: { sheetRowId: string; sheetAppendedAt?: string },
  ) => Promise<CandidateCard>;
  addAction: (candidateId: string, action: AddActionInput) => Promise<unknown>;
  isMockCandidatesEnabled: () => boolean;
  hasGoogleSheetsConfig: () => boolean;
  getGoogleSheetsConfig: () => GoogleSheetsConfig;
  ensureHeaders: (
    spreadsheetId: string,
    tabName: string,
    client?: SheetsApi,
  ) => Promise<void>;
  findRowByCandidateId: (
    spreadsheetId: string,
    tabName: string,
    candidateIdColumnIndex: number,
    candidateId: string,
    client?: SheetsApi,
  ) => Promise<FindRowResult | null>;
  appendRow: (
    spreadsheetId: string,
    tabName: string,
    values: string[],
    client?: SheetsApi,
  ) => Promise<{ updatedRange: string }>;
  mapCandidateRow: typeof mapCandidateRow;
  now: () => string;
};

function resolveDeps(overrides?: Partial<AppendDeps>): AppendDeps {
  const repo = getCandidateRepository();

  return {
    getCandidate: (id) => repo.getCandidate(id),
    updateSheetMetadata: (id, meta) => repo.updateSheetMetadata(id, meta),
    addAction: async (candidateId, action) => {
      if (!repo.addAction) {
        throw new Error("Candidate repository does not support addAction");
      }
      return repo.addAction(candidateId, action);
    },
    isMockCandidatesEnabled,
    hasGoogleSheetsConfig,
    getGoogleSheetsConfig,
    ensureHeaders,
    findRowByCandidateId,
    appendRow,
    mapCandidateRow,
    now: () => new Date().toISOString(),
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

async function recordSheetAppendAction(
  deps: AppendDeps,
  candidateId: string,
  metadata: Json,
): Promise<void> {
  await deps.addAction(candidateId, {
    action: "SHEET_APPEND",
    metadata,
  });
}

/**
 * Idempotently append an APPROVED candidate to Google Sheets.
 *
 * Retry safety: if `appendRow` succeeds but `updateSheetMetadata` fails, we return
 * `failed` with a message noting the sheet row may already exist. The next call
 * runs `findRowByCandidateId` first and recovers via `recovered_existing_row`
 * without appending a duplicate row.
 */
export async function appendApprovedCandidate(
  candidateId: string,
  depsOverrides?: Partial<AppendDeps>,
): Promise<SheetSyncResult> {
  const deps = resolveDeps(depsOverrides);

  let candidate: CandidateDetail | null;
  try {
    candidate = await deps.getCandidate(candidateId);
  } catch (error) {
    return {
      status: "failed",
      candidateId,
      message: errorMessage(error),
    };
  }

  if (!candidate) {
    return {
      status: "failed",
      candidateId,
      message: `Candidate not found: ${candidateId}`,
    };
  }

  if (candidate.status !== "APPROVED") {
    return {
      status: "skipped_not_approved",
      candidateId,
      message: `Candidate status is ${candidate.status}, expected APPROVED`,
    };
  }

  if (candidate.sheetAppendedAt && candidate.sheetRowId) {
    return {
      status: "already_synced",
      candidateId,
      rowId: candidate.sheetRowId,
    };
  }

  if (deps.isMockCandidatesEnabled()) {
    const rowId = `mock-row:${candidateId}`;
    const appendedAt = deps.now();
    try {
      await deps.updateSheetMetadata(candidateId, {
        sheetRowId: rowId,
        sheetAppendedAt: appendedAt,
      });
      await recordSheetAppendAction(deps, candidateId, {
        ok: true,
        mock: true,
        rowId,
      });
    } catch (error) {
      return {
        status: "failed",
        candidateId,
        message: errorMessage(error),
      };
    }
    return {
      status: "mock_synced",
      candidateId,
      rowId,
    };
  }

  if (!deps.hasGoogleSheetsConfig()) {
    return {
      status: "skipped_not_configured",
      candidateId,
      message: "Google Sheets is not configured",
    };
  }

  let config: GoogleSheetsConfig;
  try {
    config = deps.getGoogleSheetsConfig();
  } catch (error) {
    return {
      status: "failed",
      candidateId,
      message: errorMessage(error),
    };
  }

  const { spreadsheetId, tabName } = config;

  try {
    await deps.ensureHeaders(spreadsheetId, tabName);
  } catch (error) {
    const message = errorMessage(error);
    await recordSheetAppendAction(deps, candidateId, {
      ok: false,
      error: message,
      phase: "ensure_headers",
    }).catch(() => undefined);
    return {
      status: "failed",
      candidateId,
      message,
    };
  }

  let existingRow: FindRowResult | null;
  try {
    existingRow = await deps.findRowByCandidateId(
      spreadsheetId,
      tabName,
      CANDIDATE_ID_COLUMN_INDEX,
      candidate.id,
    );
  } catch (error) {
    const message = errorMessage(error);
    await recordSheetAppendAction(deps, candidateId, {
      ok: false,
      error: message,
      phase: "find_row",
    }).catch(() => undefined);
    return {
      status: "failed",
      candidateId,
      message,
    };
  }

  if (existingRow) {
    const rowId = existingRow.range;
    const appendedAt = deps.now();
    try {
      await deps.updateSheetMetadata(candidateId, {
        sheetRowId: rowId,
        sheetAppendedAt: appendedAt,
      });
      await recordSheetAppendAction(deps, candidateId, {
        ok: true,
        recovered: true,
        rowId,
        rowNumber: existingRow.rowNumber,
      });
    } catch (error) {
      const message = errorMessage(error);
      await recordSheetAppendAction(deps, candidateId, {
        ok: false,
        error: message,
        phase: "metadata_after_recover",
        rowId,
      }).catch(() => undefined);
      return {
        status: "failed",
        candidateId,
        rowId,
        message: `Found existing Sheet row but metadata update failed: ${message}`,
      };
    }
    return {
      status: "recovered_existing_row",
      candidateId,
      rowId,
    };
  }

  let updatedRange: string;
  try {
    const values = deps.mapCandidateRow(candidate);
    const appendResult = await deps.appendRow(spreadsheetId, tabName, values);
    updatedRange = appendResult.updatedRange;
  } catch (error) {
    const message = errorMessage(error);
    await recordSheetAppendAction(deps, candidateId, {
      ok: false,
      error: message,
      phase: "append",
    }).catch(() => undefined);
    return {
      status: "failed",
      candidateId,
      message,
    };
  }

  // Append succeeded. If metadata write fails, retry will find the sheet row first
  // (see findRowByCandidateId above) and recover without a second append.
  try {
    await deps.updateSheetMetadata(candidateId, {
      sheetRowId: updatedRange,
      sheetAppendedAt: deps.now(),
    });
  } catch (error) {
    const message = errorMessage(error);
    await recordSheetAppendAction(deps, candidateId, {
      ok: false,
      error: message,
      phase: "metadata_after_append",
      rowId: updatedRange,
      appendSucceeded: true,
    }).catch(() => undefined);
    return {
      status: "failed",
      candidateId,
      rowId: updatedRange,
      message: `Sheet append succeeded but metadata update failed (retry will recover via Candidate ID lookup): ${message}`,
    };
  }

  await recordSheetAppendAction(deps, candidateId, {
    ok: true,
    rowId: updatedRange,
  });

  return {
    status: "appended",
    candidateId,
    rowId: updatedRange,
  };
}
