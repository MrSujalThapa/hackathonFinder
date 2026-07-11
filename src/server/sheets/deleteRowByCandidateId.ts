import { hasGoogleSheetsConfig } from "@/config/env";
import { getGoogleSheetsConfig } from "@/lib/google/config";
import {
  deleteDimensionRow,
  findRowByCandidateId,
  getSheetIdByTitle,
  type SheetsApi,
} from "@/lib/google/sheetsClient";
import type {
  DeleteDimensionResult,
  FindRowResult,
  GoogleSheetsConfig,
} from "@/lib/google/types";
import { GoogleSheetsError } from "@/lib/google/types";
import { CANDIDATE_ID_COLUMN_INDEX } from "@/server/sheets/schema";
import type { DeleteRowByCandidateIdResult } from "@/server/sheets/types";

export type DeleteRowDeps = {
  hasGoogleSheetsConfig: () => boolean;
  getGoogleSheetsConfig: () => GoogleSheetsConfig;
  findRowByCandidateId: (
    spreadsheetId: string,
    tabName: string,
    candidateIdColumnIndex: number,
    candidateId: string,
    client?: SheetsApi,
  ) => Promise<FindRowResult | null>;
  getSheetIdByTitle: (
    spreadsheetId: string,
    tabName: string,
    client?: SheetsApi,
  ) => Promise<number>;
  deleteDimensionRow: (
    spreadsheetId: string,
    sheetId: number,
    rowNumber: number,
    client?: SheetsApi,
  ) => Promise<DeleteDimensionResult>;
};

function resolveDeps(overrides?: Partial<DeleteRowDeps>): DeleteRowDeps {
  return {
    hasGoogleSheetsConfig,
    getGoogleSheetsConfig,
    findRowByCandidateId,
    getSheetIdByTitle,
    deleteDimensionRow,
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

/**
 * Delete a Google Sheet row by Candidate ID.
 *
 * Always re-resolves the live row via Candidate ID lookup — never trusts a
 * stored sheet_row_id alone (A1 ranges go stale after DeleteDimension shifts).
 */
export async function deleteRowByCandidateId(
  candidateId: string,
  depsOverrides?: Partial<DeleteRowDeps>,
): Promise<DeleteRowByCandidateIdResult> {
  const deps = resolveDeps(depsOverrides);

  if (!deps.hasGoogleSheetsConfig()) {
    return {
      status: "already_absent",
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

  let existingRow: FindRowResult | null;
  try {
    existingRow = await deps.findRowByCandidateId(
      spreadsheetId,
      tabName,
      CANDIDATE_ID_COLUMN_INDEX,
      candidateId,
    );
  } catch (error) {
    return {
      status: "failed",
      candidateId,
      message: errorMessage(error),
    };
  }

  if (!existingRow) {
    return {
      status: "already_absent",
      candidateId,
    };
  }

  if (existingRow.rowNumber < 2) {
    return {
      status: "failed",
      candidateId,
      rowNumber: existingRow.rowNumber,
      range: existingRow.range,
      message: `Refusing to delete protected row ${existingRow.rowNumber}`,
    };
  }

  let sheetId: number;
  try {
    sheetId = await deps.getSheetIdByTitle(spreadsheetId, tabName);
  } catch (error) {
    return {
      status: "failed",
      candidateId,
      rowNumber: existingRow.rowNumber,
      range: existingRow.range,
      message: errorMessage(error),
    };
  }

  try {
    await deps.deleteDimensionRow(
      spreadsheetId,
      sheetId,
      existingRow.rowNumber,
    );
  } catch (error) {
    return {
      status: "failed",
      candidateId,
      rowNumber: existingRow.rowNumber,
      range: existingRow.range,
      message: errorMessage(error),
    };
  }

  return {
    status: "deleted",
    candidateId,
    rowNumber: existingRow.rowNumber,
    range: existingRow.range,
  };
}
