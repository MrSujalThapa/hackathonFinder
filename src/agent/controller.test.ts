import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDefaultDiscoveryPreferences } from "@/agent/parseCommand";
import { runDiscovery } from "@/agent/controller";
import { runCollectors } from "@/collectors/registry";
import type { Collector, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";
import { mockCollector } from "@/collectors/mock";

const failingCollector: Collector = {
  source: "hacklist",
  async collect(): Promise<CollectorResult> {
    const result = emptyCollectorResult("hacklist");
    result.errors.push("Simulated HackList failure");
    result.durationMs = 1;
    return result;
  },
};

describe("runDiscovery", () => {
  it("runs end-to-end in dry-run mode without Supabase writes", async () => {
    const summary = await runDiscovery(
      {
        ...getDefaultDiscoveryPreferences("find upcoming hackathons"),
        sources: ["mock"],
      },
      true,
    );

    assert.equal(summary.rawLeads, 7);
    assert.equal(summary.extracted, 7);
    assert.equal(summary.uniqueLeads, 6);
    assert.equal(summary.crossSourceMerges, 1);
    assert.ok(summary.accepted >= 3);
    assert.ok(summary.rejected >= 3);
    assert.equal(summary.wouldCreate, 3);
    assert.equal(summary.wouldUpdate, 0);
    assert.equal(summary.stored, 3);
    assert.equal(summary.created, 0);
    assert.equal(summary.dryRun, true);
    assert.ok(summary.sourceStats.some((stats) => stats.source === "mock"));
  });

  it("respects Toronto and AI-focused command preferences", async () => {
    const summary = await runDiscovery(
      {
        ...getDefaultDiscoveryPreferences(
          "find upcoming hackathons in Toronto or remote focused on AI agents",
        ),
        sources: ["mock"],
      },
      true,
    );

    assert.ok(summary.preferences.locations.includes("Toronto"));
    assert.ok(summary.preferences.themes.includes("AI"));
    assert.ok(summary.acceptedCandidates.length > 0);
  });

  it("continues when one collector fails", async () => {
    const preferences = {
      ...getDefaultDiscoveryPreferences("find upcoming hackathons"),
      sources: ["hacklist", "mock"] as const,
    };

    const results = await runCollectors(
      {
        preferences: { ...preferences, sources: ["hacklist", "mock"] },
        maxResults: 10,
        timeoutMs: 1000,
        dryRun: true,
      },
      ["hacklist", "mock"],
    );

    assert.equal(results.length, 2);
    assert.ok(results.some((result) => result.source === "mock" && result.leads.length > 0));
  });
});

describe("runCollectors failure isolation", () => {
  it("captures collector errors without throwing", async () => {
    const preferences = getDefaultDiscoveryPreferences("find upcoming hackathons");

    const results = await Promise.all([
      failingCollector.collect({
        preferences,
        maxResults: 5,
        timeoutMs: 1000,
        dryRun: true,
      }),
      mockCollector.collect({
        preferences,
        maxResults: 5,
        timeoutMs: 1000,
        dryRun: true,
      }),
    ]);

    assert.ok(results[0]?.errors.length);
    assert.ok((results[1]?.leads.length ?? 0) > 0);
  });
});
