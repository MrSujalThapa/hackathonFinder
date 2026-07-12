import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { xMcpCollector } from "@/collectors/xMcp";
import type { DiscoveryPreferences } from "@/core/discovery/types";

const preferences: DiscoveryPreferences = {
  rawCommand: "find hackathons on x",
  locations: ["Toronto"],
  themes: ["AI"],
  modes: [],
  sources: ["x"],
  includeRemote: true,
  includeInPerson: true,
  maxResults: 10,
};

describe("xMcpCollector skeleton", () => {
  it("warns and returns empty leads when X config is missing", async () => {
    const prevBearer = process.env.X_BEARER_TOKEN;
    const prevUrl = process.env.X_MCP_URL;
    delete process.env.X_BEARER_TOKEN;
    delete process.env.X_MCP_URL;

    try {
      // Clear cached env if present
      const { getServerEnv } = await import("@/config/env");
      // Force re-parse by mutating cache is not exported — collector uses hasXConfig
      // which reads getServerEnv. Reset via setting empty and relying on process.env
      // already deleted; hasXConfig may use cached env from prior tests.
      const result = await xMcpCollector.collect({
        preferences,
        maxResults: 10,
        timeoutMs: 5000,
        dryRun: true,
      });

      assert.equal(result.source, "x");
      assert.equal(result.leads.length, 0);
      assert.ok(result.warnings.some((w) => /X MCP/i.test(w) || /skipping/i.test(w)));
      assert.equal(result.errors.length, 0);
      void getServerEnv;
    } finally {
      if (prevBearer !== undefined) process.env.X_BEARER_TOKEN = prevBearer;
      else delete process.env.X_BEARER_TOKEN;
      if (prevUrl !== undefined) process.env.X_MCP_URL = prevUrl;
      else delete process.env.X_MCP_URL;
    }
  });
});
