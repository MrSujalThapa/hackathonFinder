import {
  getHeaderRow,
  writeHeaderRow,
  type SheetsApi,
} from "@/lib/google/sheetsClient";
import { GoogleSheetsError } from "@/lib/google/types";

export const SHEET_HEADERS = [
  "Status",
  "Score",
  "Name",
  "Source",
  "Official URL",
  "Apply URL",
  "Social URL",
  "Start Date",
  "End Date",
  "Deadline",
  "Location",
  "Mode",
  "City",
  "Country",
  "Prize",
  "Themes",
  "Eligibility",
  "Summary",
  "Why Match",
  "Red Flags",
  "Found At",
  "Last Verified",
  "Approved At",
  "Candidate ID",
] as const;

export type SheetHeader = (typeof SHEET_HEADERS)[number];

export const CANDIDATE_ID_COLUMN_INDEX = SHEET_HEADERS.length - 1;

function isEmptyHeaderRow(existing: string[]): boolean {
  return (
    existing.length === 0 || existing.every((cell) => cell.trim().length === 0)
  );
}

export function assertCompatibleHeaders(
  existing: string[],
): { ok: true } | { ok: false; message: string } {
  if (isEmptyHeaderRow(existing)) {
    return { ok: true };
  }

  if (existing.length !== SHEET_HEADERS.length) {
    return {
      ok: false,
      message: `Incompatible sheet headers: expected ${SHEET_HEADERS.length} columns, found ${existing.length}`,
    };
  }

  for (let i = 0; i < SHEET_HEADERS.length; i++) {
    if (existing[i] !== SHEET_HEADERS[i]) {
      return {
        ok: false,
        message: `Incompatible sheet headers at column ${i + 1}: expected "${SHEET_HEADERS[i]}", found "${existing[i] ?? ""}"`,
      };
    }
  }

  return { ok: true };
}

export async function ensureHeaders(
  spreadsheetId: string,
  tabName: string,
  client?: SheetsApi,
): Promise<void> {
  const existing = await getHeaderRow(spreadsheetId, tabName, client);
  const check = assertCompatibleHeaders(existing);

  if (!check.ok) {
    throw new GoogleSheetsError("incompatible_headers", check.message);
  }

  if (isEmptyHeaderRow(existing)) {
    await writeHeaderRow(spreadsheetId, tabName, [...SHEET_HEADERS], client);
  }
}
