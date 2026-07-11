import { google, type sheets_v4 } from "googleapis";
import { getGoogleSheetsConfig } from "@/lib/google/config";
import {
  GoogleSheetsError,
  type DeleteDimensionResult,
  type FindRowResult,
  type SpreadsheetMetadata,
} from "@/lib/google/types";

export type SheetsApi = sheets_v4.Sheets;

function quoteSheetName(tabName: string): string {
  if (/^[A-Za-z0-9_]+$/.test(tabName)) {
    return tabName;
  }
  return `'${tabName.replace(/'/g, "''")}'`;
}

/** Convert 0-based column index to A1 column letters (0 → A, 25 → Z, 26 → AA). */
export function columnIndexToLetter(index: number): string {
  if (index < 0) {
    throw new RangeError(`column index must be >= 0, got ${index}`);
  }
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function classifyGoogleApiError(error: unknown): GoogleSheetsError {
  if (error instanceof GoogleSheetsError) {
    return error;
  }

  const err = error as {
    message?: string;
    code?: number | string;
    status?: number | string;
    errors?: Array<{ message?: string; reason?: string }>;
    response?: { status?: number; data?: { error?: { message?: string } } };
    cause?: unknown;
  };

  const status = Number(
    err?.response?.status ?? err?.status ?? err?.code ?? NaN,
  );
  const apiMessage =
    err?.response?.data?.error?.message ??
    err?.errors?.[0]?.message ??
    err?.message ??
    String(error);
  const reason = err?.errors?.[0]?.reason ?? "";
  const combined = `${apiMessage} ${reason}`.toLowerCase();

  if (
    combined.includes("enotfound") ||
    combined.includes("eai_again") ||
    combined.includes("getaddrinfo") ||
    combined.includes("enetunreach") ||
    combined.includes("econnrefused") ||
    combined.includes("econnreset") ||
    combined.includes("etimedout") ||
    combined.includes("network") ||
    combined.includes("socket hang up")
  ) {
    return new GoogleSheetsError("network_failure", apiMessage, error);
  }

  if (
    status === 404 ||
    combined.includes("requested entity was not found") ||
    combined.includes("not found")
  ) {
    return new GoogleSheetsError("spreadsheet_not_found", apiMessage, error);
  }

  if (
    status === 403 ||
    combined.includes("permission") ||
    combined.includes("forbidden") ||
    combined.includes("does not have permission") ||
    combined.includes("the caller does not have permission") ||
    combined.includes("not shared")
  ) {
    return new GoogleSheetsError(
      "not_shared",
      "Service account cannot access this spreadsheet. Share the sheet with the service account client_email.",
      error,
    );
  }

  if (
    status === 401 ||
    combined.includes("invalid_grant") ||
    combined.includes("invalid credentials") ||
    combined.includes("unauthorized") ||
    combined.includes("invalid_client")
  ) {
    return new GoogleSheetsError("invalid_credentials", apiMessage, error);
  }

  return new GoogleSheetsError("network_failure", apiMessage, error);
}

async function withSheetsError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw classifyGoogleApiError(error);
  }
}

export function createSheetsClient(
  config = getGoogleSheetsConfig(),
): SheetsApi {
  const auth = new google.auth.JWT({
    email: config.serviceAccount.client_email,
    key: config.serviceAccount.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

export async function getSpreadsheetMetadata(
  spreadsheetId: string,
  client: SheetsApi = createSheetsClient(),
): Promise<SpreadsheetMetadata> {
  return withSheetsError(async () => {
    const response = await client.spreadsheets.get({
      spreadsheetId,
      fields:
        "spreadsheetId,properties.title,sheets.properties(sheetId,title)",
    });

    const sheets =
      response.data.sheets
        ?.map((sheet) => {
          const title = sheet.properties?.title;
          const sheetId = sheet.properties?.sheetId;
          if (!title || sheetId === undefined || sheetId === null) {
            return null;
          }
          return { title, sheetId };
        })
        .filter(
          (sheet): sheet is { title: string; sheetId: number } => sheet !== null,
        ) ?? [];

    return {
      spreadsheetId: response.data.spreadsheetId ?? spreadsheetId,
      title: response.data.properties?.title ?? "",
      sheetTitles: sheets.map((sheet) => sheet.title),
      sheets,
    };
  });
}

/**
 * Resolve the numeric sheetId for a tab title (required by DeleteDimension).
 */
export async function getSheetIdByTitle(
  spreadsheetId: string,
  tabName: string,
  client: SheetsApi = createSheetsClient(),
): Promise<number> {
  const metadata = await getSpreadsheetMetadata(spreadsheetId, client);
  const match = metadata.sheets.find((sheet) => sheet.title === tabName);
  if (!match) {
    throw new GoogleSheetsError(
      "tab_missing",
      `Sheet tab "${tabName}" was not found. Available tabs: ${
        metadata.sheetTitles.length ? metadata.sheetTitles.join(", ") : "(none)"
      }`,
    );
  }
  return match.sheetId;
}

/**
 * Delete a single row by 1-based row number via DeleteDimension (rows shift up).
 * Guards against deleting the header row (rowNumber must be >= 2).
 */
export async function deleteDimensionRow(
  spreadsheetId: string,
  sheetId: number,
  rowNumber: number,
  client: SheetsApi = createSheetsClient(),
): Promise<DeleteDimensionResult> {
  if (rowNumber < 2) {
    throw new RangeError(
      `Refusing to delete row ${rowNumber}: header row and invalid rows are protected`,
    );
  }

  return withSheetsError(async () => {
    await client.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: rowNumber - 1,
                endIndex: rowNumber,
              },
            },
          },
        ],
      },
    });

    return { sheetId, rowNumber };
  });
}

export async function getSheetTabNames(
  spreadsheetId: string,
  client: SheetsApi = createSheetsClient(),
): Promise<string[]> {
  const metadata = await getSpreadsheetMetadata(spreadsheetId, client);
  return metadata.sheetTitles;
}

export async function ensureTabExists(
  spreadsheetId: string,
  tabName: string,
  client: SheetsApi = createSheetsClient(),
): Promise<void> {
  const tabs = await getSheetTabNames(spreadsheetId, client);
  if (!tabs.includes(tabName)) {
    throw new GoogleSheetsError(
      "tab_missing",
      `Sheet tab "${tabName}" was not found. Available tabs: ${tabs.length ? tabs.join(", ") : "(none)"}`,
    );
  }
}

export async function getHeaderRow(
  spreadsheetId: string,
  tabName: string,
  client: SheetsApi = createSheetsClient(),
): Promise<string[]> {
  return withSheetsError(async () => {
    const range = `${quoteSheetName(tabName)}!1:1`;
    const response = await client.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    const row = response.data.values?.[0] ?? [];
    return row.map((cell) => String(cell ?? ""));
  });
}

export async function writeHeaderRow(
  spreadsheetId: string,
  tabName: string,
  headers: string[],
  client: SheetsApi = createSheetsClient(),
): Promise<void> {
  await withSheetsError(async () => {
    const endCol = columnIndexToLetter(Math.max(headers.length - 1, 0));
    const range = `${quoteSheetName(tabName)}!A1:${endCol}1`;
    await client.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  });
}

export async function appendRow(
  spreadsheetId: string,
  tabName: string,
  values: string[],
  client: SheetsApi = createSheetsClient(),
): Promise<{ updatedRange: string }> {
  return withSheetsError(async () => {
    const response = await client.spreadsheets.values.append({
      spreadsheetId,
      range: `${quoteSheetName(tabName)}!A:A`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [values] },
    });

    const updatedRange = response.data.updates?.updatedRange ?? "";
    return { updatedRange };
  });
}

export async function findRowByCandidateId(
  spreadsheetId: string,
  tabName: string,
  candidateIdColumnIndex: number,
  candidateId: string,
  client: SheetsApi = createSheetsClient(),
): Promise<FindRowResult | null> {
  return withSheetsError(async () => {
    const col = columnIndexToLetter(candidateIdColumnIndex);
    const range = `${quoteSheetName(tabName)}!${col}:${col}`;
    const response = await client.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const rows = response.data.values ?? [];
    for (let i = 0; i < rows.length; i++) {
      const cell = String(rows[i]?.[0] ?? "");
      if (cell === candidateId) {
        const rowNumber = i + 1;
        return {
          rowNumber,
          range: `${quoteSheetName(tabName)}!${col}${rowNumber}`,
        };
      }
    }

    return null;
  });
}
