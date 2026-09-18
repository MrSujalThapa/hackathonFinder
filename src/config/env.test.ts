import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertNoSecretInClientBundleSample,
  isDemoMode,
  isFixtureCandidatesMode,
  isServerOnlyEnvName,
  serverEnvSchema,
  validateProductionConfig,
} from "@/config/env";

describe("production env validation", () => {
  it("rejects production mock mode without demo", () => {
    const parsed = serverEnvSchema.safeParse({
      NODE_ENV: "production",
      USE_MOCK_CANDIDATES: "true",
    });

    assert.equal(parsed.success, false);
  });

  it("allows production DEMO_MODE with owner auth requirements", () => {
    const parsed = serverEnvSchema.parse({
      NODE_ENV: "production",
      DEMO_MODE: "true",
      USE_MOCK_CANDIDATES: "false",
      APP_PASSWORD: "demo-password",
      APP_SESSION_SECRET: "x".repeat(32),
    });

    assert.equal(isDemoMode(parsed), true);
    assert.equal(isFixtureCandidatesMode(parsed), true);
    assert.deepEqual(validateProductionConfig(parsed), []);
  });

  it("rejects emergency persistence rollback in production", () => {
    const parsed = serverEnvSchema.safeParse({
      NODE_ENV: "production",
      PERSISTENCE_ROLLBACK_V1: "true",
    });
    assert.equal(parsed.success, false);
  });

  it("rejects malformed numeric discovery budgets", () => {
    const parsed = serverEnvSchema.safeParse({
      DISCOVERY_MAX_ACTIVE_JOBS: "0",
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

  it("classifies server-only secret names", () => {
    assert.equal(isServerOnlyEnvName("SUPABASE_SERVICE_ROLE_KEY"), true);
    assert.equal(isServerOnlyEnvName("NEXT_PUBLIC_SUPABASE_URL"), false);
  });

  it("detects secret-like client bundle samples", () => {
    const hits = assertNoSecretInClientBundleSample(
      'const x = process.env.SUPABASE_SERVICE_ROLE_KEY',
    );
    assert.ok(hits.includes("SUPABASE_SERVICE_ROLE_KEY"));
  });
});
