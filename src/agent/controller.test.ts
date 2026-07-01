import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDefaultDiscoveryPreferences } from "@/agent/parseCommand";
import { runDiscovery } from "@/agent/controller";

describe("runDiscovery", () => {
  it("runs end-to-end in dry-run mode without Supabase writes", async () => {
    const summary = await runDiscovery(
      getDefaultDiscoveryPreferences("find upcoming hackathons"),
      true,
    );

    assert.equal(summary.rawLeads, 7);
    assert.equal(summary.extracted, 7);
    assert.ok(summary.accepted >= 3);
    assert.ok(summary.rejected >= 3);
    assert.equal(summary.stored, 3);
    assert.equal(summary.duplicatesUpdated, 1);
    assert.equal(summary.dryRun, true);
  });

  it("respects Toronto and AI-focused command preferences", async () => {
    const summary = await runDiscovery(
      getDefaultDiscoveryPreferences(
        "find upcoming hackathons in Toronto or remote focused on AI agents",
      ),
      true,
    );

    assert.ok(summary.preferences.locations.includes("Toronto"));
    assert.ok(summary.preferences.themes.includes("AI"));
    assert.ok(summary.acceptedCandidates.length > 0);
  });
});
