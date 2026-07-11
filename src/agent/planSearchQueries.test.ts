import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatSearchPlan, planSearchQueries } from "@/agent/planSearchQueries";
import type { DiscoveryPreferences } from "@/core/discovery/types";

function prefs(overrides: Partial<DiscoveryPreferences> = {}): DiscoveryPreferences {
  return {
    rawCommand: "find AI agent hackathons in Toronto or remote",
    locations: ["Toronto", "Canada", "Remote"],
    dateFrom: "2026-07-01",
    dateTo: "2026-12-31",
    themes: ["AI", "agents"],
    modes: ["online", "in-person"],
    sources: ["web"],
    includeRemote: true,
    includeInPerson: true,
    maxResults: 20,
    ...overrides,
  };
}

describe("planSearchQueries", () => {
  it("produces a deterministic capped set of focused queries", () => {
    const first = planSearchQueries(prefs());
    const second = planSearchQueries(prefs());
    assert.deepEqual(first, second);
    assert.ok(first.length >= 6);
    assert.ok(first.length <= 10);
  });

  it("includes location, theme, mode, and site constraints", () => {
    const queries = planSearchQueries(prefs());
    const joined = queries.join("\n");
    assert.match(joined, /Toronto/i);
    assert.match(joined, /AI|agent/i);
    assert.match(joined, /remote|online/i);
    assert.match(joined, /site:lu\.ma/);
    assert.match(joined, /site:mlh\.io/);
    assert.match(joined, /site:devpost\.com/);
  });

  it("dedupes near-identical queries", () => {
    const queries = planSearchQueries(
      prefs({ locations: ["Toronto", "Toronto"], themes: ["AI", "AI"] }),
    );
    const lower = queries.map((q) => q.toLowerCase());
    assert.equal(new Set(lower).size, lower.length);
  });

  it("formats a readable plan", () => {
    const plan = formatSearchPlan(["hackathon Toronto apply", "site:mlh.io events Canada"]);
    assert.match(plan, /^1\. hackathon Toronto apply/);
    assert.match(plan, /2\. site:mlh\.io/);
  });
});
