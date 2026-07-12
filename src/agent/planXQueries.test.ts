import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatXPlan, planXQueries } from "@/agent/planXQueries";
import type { DiscoveryPreferences } from "@/core/discovery/types";

function prefs(overrides: Partial<DiscoveryPreferences> = {}): DiscoveryPreferences {
  return {
    rawCommand: "find AI agent hackathons in Toronto or remote",
    locations: ["Toronto", "Canada", "Remote"],
    dateFrom: "2026-07-01",
    dateTo: "2026-12-31",
    themes: ["AI", "agents"],
    modes: ["online", "in-person"],
    sources: ["x"],
    includeRemote: true,
    includeInPerson: true,
    maxResults: 20,
    ...overrides,
  };
}

describe("planXQueries", () => {
  it("produces a deterministic capped set of queries", () => {
    const first = planXQueries(prefs());
    const second = planXQueries(prefs());
    assert.deepEqual(first, second);
    assert.ok(first.length >= 1);
    assert.ok(first.length <= 6);
  });

  it("respects maxQueries", () => {
    const queries = planXQueries(prefs(), { maxQueries: 3 });
    assert.equal(queries.length, 3);
    assert.deepEqual(queries, planXQueries(prefs(), { maxQueries: 3 }));
  });

  it("includes location and theme signals", () => {
    const queries = planXQueries(prefs());
    const joined = queries.join("\n");
    assert.match(joined, /Toronto/i);
    assert.match(joined, /AI|agent/i);
    assert.match(joined, /hackathon|buildathon|codefest/i);
    assert.doesNotMatch(joined, /site:/i);
  });

  it("includes remote when includeRemote", () => {
    const withRemote = planXQueries(prefs({ includeRemote: true }));
    assert.match(withRemote.join("\n"), /remote/i);

    const withoutRemote = planXQueries(
      prefs({ includeRemote: false, themes: ["AI"], locations: ["Toronto"] }),
      { maxQueries: 8 },
    );
    // Theme query should use location, not remote, when includeRemote is false
    assert.ok(withoutRemote.some((q) => /AI hackathon Toronto/i.test(q)));
    assert.ok(!withoutRemote.some((q) => /AI hackathon remote/i.test(q)));
  });

  it("dedupes duplicate location/theme prefs", () => {
    const queries = planXQueries(
      prefs({ locations: ["Toronto", "Toronto"], themes: ["AI", "AI"] }),
      { maxQueries: 10 },
    );
    const lower = queries.map((q) => q.toLowerCase());
    assert.equal(new Set(lower).size, lower.length);
  });

  it("stays bounded in length and avoids near-identical floods", () => {
    const queries = planXQueries(prefs(), { maxQueries: 20 });
    assert.ok(queries.length <= 10);
    for (const q of queries) {
      assert.ok(q.length > 0 && q.length < 120);
    }
  });

  it("formats a readable plan", () => {
    const plan = formatXPlan([
      "hackathon Toronto -is:retweet",
      'from:MLHacks hackathon',
    ]);
    assert.match(plan, /^1\. hackathon Toronto -is:retweet/);
    assert.match(plan, /2\. from:MLHacks hackathon/);
    assert.equal(formatXPlan([]), "(no X queries planned)");
  });
});
