export type GoogleSheetsErrorCode =
  | "invalid_json"
  | "invalid_credentials"
  | "not_shared"
  | "spreadsheet_not_found"
  | "tab_missing"
  | "network_failure"
  | "incompatible_headers";

export class GoogleSheetsError extends Error {
  readonly code: GoogleSheetsErrorCode;
  readonly cause: unknown;

  constructor(code: GoogleSheetsErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "GoogleSheetsError";
    this.code = code;
    this.cause = cause;
  }
}

export type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  type?: string;
  project_id?: string;
  private_key_id?: string;
  client_id?: string;
  universe_domain?: string;
  [key: string]: unknown;
};

export type GoogleSheetsConfig = {
  spreadsheetId: string;
  tabName: string;
  serviceAccount: GoogleServiceAccount;
  publicSheetUrl?: string;
};

export type SpreadsheetMetadata = {
  spreadsheetId: string;
  title: string;
  sheetTitles: string[];
};

export type FindRowResult = {
  rowNumber: number;
  range: string;
};
