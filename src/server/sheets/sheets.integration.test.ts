/**
 * Opt-in live Google Sheets integration checks.
 * Skipped unless RUN_GOOGLE_SHEETS_INTEGRATION=true and Sheets env is configured.
 * Never runs in the default `npm test` path for CI without secrets.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadLocalEnv } from "@/cli/loadEnv";
import { hasGoogleSheetsConfig, getServerEnv } from "@/config/env";
import { getGoogleSheetsConfig } from "@/lib/google/config";
import {
  getSpreadsheetMetadata,
  ensureTabExists,
} from "@/lib/google/sheetsClient";

const enabled = process.env.RUN_GOOGLE_SHEETS_INTEGRATION === "true";

describe("Google Sheets live integration (opt-in)", { skip: !enabled }, () => {
  it("authenticates and finds the configured tab without writing", async () => {
    loadLocalEnv();
    const env = getServerEnv();
    assert.ok(
      hasGoogleSheetsConfig(env),
      "Set GOOGLE_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON for live integration",
    );

    const config = getGoogleSheetsConfig();
    const meta = await getSpreadsheetMetadata(config.spreadsheetId);
    assert.ok(meta.title);
    await ensureTabExists(config.spreadsheetId, config.tabName);
  });
});
