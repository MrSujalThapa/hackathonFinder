import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { resetServerEnvCacheForTests } from "@/config/env";
import { executeDiscoveryPipeline } from "@/discovery/pipeline";
import type { DiscoveryPreferences } from "@/core/discovery/types";

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("demo mode discovery write guard", () => {
  const previous = {
    DEMO_MODE: process.env.DEMO_MODE,
    USE_MOCK_CANDIDATES: process.env.USE_MOCK_CANDIDATES,
  };

  beforeEach(() => {
    resetServerEnvCacheForTests();
    setEnv({ DEMO_MODE: "true", USE_MOCK_CANDIDATES: "false" });
  });

  afterEach(() => {
    resetServerEnvCacheForTests();
    setEnv(previous);
  });

  it("forces dry-run persistence when DEMO_MODE is enabled", async () => {
    const preferences = {
      rawCommand: "find upcoming hackathons",
      sources: ["mock"],
      profile: "light",
      themes: [],
      locations: [],
      includeRemote: false,
      dateFrom: null,
      dateTo: null,
      reviewPolicy: "strict",
      maxResults: 5,
    } as unknown as DiscoveryPreferences;

    const summary = await executeDiscoveryPipeline(preferences, false, {
      dryRunPlan: true,
    });

    assert.equal(summary.dryRun, true);
    assert.ok(
      summary.warnings.some((warning) => warning.includes("DEMO_MODE=true")),
    );
  });
});
