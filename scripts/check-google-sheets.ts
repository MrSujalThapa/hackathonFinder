/**
 * Read-only Google Sheets connectivity diagnostics.
 * Never prints secrets. Never mutates data.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "../src/cli/loadEnv";
import { parseServiceAccountJson } from "../src/lib/google/config";
import {
  createSheetsClient,
  getSheetTabNames,
  getSpreadsheetMetadata,
} from "../src/lib/google/sheetsClient";
import {
  GoogleSheetsError,
  type GoogleSheetsErrorCode,
} from "../src/lib/google/types";

type FailureCategory = GoogleSheetsErrorCode | "missing_env" | "unknown";

function present(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function classifyFailure(error: unknown): {
  category: FailureCategory;
  message: string;
  cause: unknown;
} {
  if (error instanceof GoogleSheetsError) {
    return {
      category: error.code,
      message: error.message,
      cause: error.cause,
    };
  }

  const err = error as {
    message?: string;
    cause?: unknown;
    code?: string;
  };
  const message = err?.message ?? String(error);
  const cause = err?.cause ?? null;
  const combined = `${message} ${String(cause ?? "")}`.toLowerCase();

  if (
    combined.includes("enotfound") ||
    combined.includes("econnrefused") ||
    combined.includes("etimedout") ||
    combined.includes("network")
  ) {
    return { category: "network_failure", message, cause };
  }

  return { category: "unknown", message, cause };
}

function printCause(cause: unknown, indent = "  "): void {
  if (cause == null) {
    console.log(`${indent}cause: (none)`);
    return;
  }
  if (cause instanceof Error) {
    console.log(`${indent}cause.name: ${cause.name}`);
    console.log(`${indent}cause.message: ${cause.message}`);
    const nested = (cause as Error & { cause?: unknown }).cause;
    if (nested) {
      printCause(nested, `${indent}  `);
    }
    return;
  }
  if (typeof cause === "object") {
    const obj = cause as Record<string, unknown>;
    for (const key of ["code", "errno", "syscall", "hostname", "message", "reason"]) {
      if (key in obj && obj[key] != null) {
        console.log(`${indent}cause.${key}: ${String(obj[key])}`);
      }
    }
    return;
  }
  console.log(`${indent}cause: ${String(cause)}`);
}

async function main(): Promise<number> {
  console.log("=== Google Sheets connectivity check ===\n");

  const cwd = process.cwd();
  console.log(`cwd: ${cwd}`);
  console.log(`loading env via loadLocalEnv() from repository root`);
  loadLocalEnv();

  const sheetId = process.env.GOOGLE_SHEET_ID?.trim();
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  const tabName = process.env.GOOGLE_SHEET_TAB?.trim() || "Hackathons";
  const publicUrl = process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL?.trim();

  console.log("\n--- Environment ---");
  console.log(`GOOGLE_SHEET_ID: ${present(sheetId) ? "set" : "MISSING"}`);
  console.log(
    `GOOGLE_SERVICE_ACCOUNT_JSON: ${present(serviceAccountJson) ? "set" : "MISSING"}`,
  );
  console.log(`GOOGLE_SHEET_TAB: ${tabName}`);
  console.log(
    `NEXT_PUBLIC_GOOGLE_SHEET_URL: ${present(publicUrl) ? "set" : "not set"}`,
  );

  if (!present(sheetId) || !present(serviceAccountJson)) {
    console.log("\nRESULT: FAIL");
    console.log("category: missing_env");
    console.log(
      "Configure GOOGLE_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON in .env.local",
    );
    return 1;
  }

  console.log("\n--- Service account parse ---");
  let clientEmail = "(unknown)";
  try {
    const serviceAccount = parseServiceAccountJson(serviceAccountJson!);
    clientEmail = serviceAccount.client_email;
    console.log(`client_email: ${clientEmail}`);
    console.log("private_key: present (not printed)");
  } catch (error) {
    const { category, message, cause } = classifyFailure(error);
    console.log("\nRESULT: FAIL");
    console.log(`category: ${category}`);
    console.log(`message: ${message}`);
    printCause(cause);
    return 1;
  }

  console.log("\n--- Authenticate + spreadsheet metadata ---");
  try {
    // Ensure env is visible to getServerEnv / createSheetsClient.
    process.env.GOOGLE_SHEET_ID = sheetId;
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = serviceAccountJson;
    if (process.env.GOOGLE_SHEET_TAB === undefined) {
      process.env.GOOGLE_SHEET_TAB = tabName;
    }

    const client = createSheetsClient();
    const metadata = await getSpreadsheetMetadata(sheetId!, client);
    console.log(`spreadsheetId: ${metadata.spreadsheetId}`);
    console.log(`title: ${metadata.title}`);

    const tabs = await getSheetTabNames(sheetId!, client);
    console.log(`tabs (${tabs.length}): ${tabs.join(", ") || "(none)"}`);

    console.log("\n--- Configured tab ---");
    if (!tabs.includes(tabName)) {
      console.log("\nRESULT: FAIL");
      console.log("category: tab_missing");
      console.log(
        `message: Configured tab "${tabName}" was not found. Available: ${tabs.join(", ") || "(none)"}`,
      );
      return 1;
    }
    console.log(`tab "${tabName}" exists`);

    console.log("\nRESULT: OK");
    console.log(
      "Google Sheets is reachable with the configured service account (read-only check; no writes).",
    );
    return 0;
  } catch (error) {
    const { category, message, cause } = classifyFailure(error);
    console.log("\nRESULT: FAIL");
    console.log(`category: ${category}`);
    console.log(`message: ${message}`);
    printCause(cause);
    return 1;
  }
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error("Unexpected diagnostic failure:", error);
      process.exit(1);
    });
}

export { main as checkGoogleSheets };
