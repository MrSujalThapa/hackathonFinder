import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serverEnvSchema, validateProductionConfig } from "@/config/env";

describe("production env validation", () => {
  it("rejects production mock mode", () => {
    const parsed = serverEnvSchema.safeParse({
      NODE_ENV: "production",
      USE_MOCK_CANDIDATES: "true",
    });

    assert.equal(parsed.success, false);
  });

  it("reports missing production owner auth", () => {
    const parsed = serverEnvSchema.parse({
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      GOOGLE_SHEET_ID: "sheet",
      GOOGLE_SERVICE_ACCOUNT_JSON: "{}",
      USE_MOCK_CANDIDATES: "false",
    });

    assert.ok(
      validateProductionConfig(parsed).some((issue) =>
        issue.includes("Owner auth is incomplete"),
      ),
    );
  });
});
