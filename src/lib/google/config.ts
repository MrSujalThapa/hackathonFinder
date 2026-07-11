import { z } from "zod";
import {
  getGoogleSheetTab,
  getServerEnv,
  hasGoogleSheetsConfig,
} from "@/config/env";
import {
  GoogleSheetsError,
  type GoogleServiceAccount,
  type GoogleSheetsConfig,
} from "@/lib/google/types";

const serviceAccountSchema = z
  .object({
    client_email: z
      .string({ required_error: "missing client_email" })
      .min(1, "missing client_email"),
    private_key: z
      .string({ required_error: "missing private_key" })
      .min(1, "missing private_key")
      .transform((key) => key.replace(/\\n/g, "\n")),
  })
  .passthrough();

export function parseServiceAccountJson(
  raw: string,
): GoogleServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new GoogleSheetsError(
      "invalid_json",
      "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON",
      error,
    );
  }

  const result = serviceAccountSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => issue.message).join("; ");
    const missingEmail = result.error.issues.some(
      (issue) =>
        issue.path.includes("client_email") ||
        issue.message.includes("client_email"),
    );
    const missingKey = result.error.issues.some(
      (issue) =>
        issue.path.includes("private_key") ||
        issue.message.includes("private_key"),
    );

    let message = `Invalid Google service account credentials: ${issues}`;
    if (missingEmail && !missingKey) {
      message = "GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email";
    } else if (missingKey && !missingEmail) {
      message = "GOOGLE_SERVICE_ACCOUNT_JSON is missing private_key";
    } else if (missingEmail && missingKey) {
      message =
        "GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email and private_key";
    }

    throw new GoogleSheetsError("invalid_credentials", message, result.error);
  }

  return result.data as GoogleServiceAccount;
}

export function getGoogleSheetsConfig(): GoogleSheetsConfig {
  const env = getServerEnv();

  if (!hasGoogleSheetsConfig(env)) {
    throw new GoogleSheetsError(
      "invalid_credentials",
      "Google Sheets is not configured. Set GOOGLE_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON.",
    );
  }

  const serviceAccount = parseServiceAccountJson(
    env.GOOGLE_SERVICE_ACCOUNT_JSON!,
  );

  return {
    spreadsheetId: env.GOOGLE_SHEET_ID!,
    tabName: getGoogleSheetTab(env),
    serviceAccount,
    publicSheetUrl: env.NEXT_PUBLIC_GOOGLE_SHEET_URL,
  };
}
