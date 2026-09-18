import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  getServerEnv,
  isDemoMode,
  resetServerEnvCacheForTests,
  serverEnvSchema,
} from "@/config/env";
import {
  getCandidateRepository,
  isMockCandidatesEnabled,
  setCandidateRepositoryForTests,
} from "@/server/candidates/service";

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("demo mode safeguards", () => {
  const previous = {
    DEMO_MODE: process.env.DEMO_MODE,
    USE_MOCK_CANDIDATES: process.env.USE_MOCK_CANDIDATES,
    APP_PASSWORD: process.env.APP_PASSWORD,
    APP_SESSION_SECRET: process.env.APP_SESSION_SECRET,
  };

  beforeEach(() => {
    setCandidateRepositoryForTests(null);
    resetServerEnvCacheForTests();
    setEnv({
      DEMO_MODE: "true",
      USE_MOCK_CANDIDATES: "false",
      APP_PASSWORD: "demo-password",
      APP_SESSION_SECRET: "d".repeat(40),
    });
  });

  afterEach(() => {
    setCandidateRepositoryForTests(null);
    resetServerEnvCacheForTests();
    setEnv(previous);
  });

  it("enables fixture candidates when DEMO_MODE=true", () => {
    const env = getServerEnv();
    assert.equal(isDemoMode(env), true);
    assert.equal(isMockCandidatesEnabled(), true);
  });

  it("serves in-memory candidates without requiring Supabase", async () => {
    const repo = getCandidateRepository();
    const listed = await repo.listCandidates({ status: "NEW", limit: 10 });
    assert.ok(listed.candidates.length > 0);
    assert.ok(listed.candidates.every((item) => item.name.length > 0));
  });

  it("allows DEMO_MODE under production schema when explicitly set", () => {
    const parsed = serverEnvSchema.parse({
      NODE_ENV: "production",
      DEMO_MODE: "true",
      APP_PASSWORD: "demo-password",
      APP_SESSION_SECRET: "d".repeat(40),
    });
    assert.equal(isDemoMode(parsed), true);
  });
});
