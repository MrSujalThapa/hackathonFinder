import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeCrossSourceEvents, mergeHackathonEventPair, mergeSourceIds } from "@/core/mergeEvents";
import type { HackathonEvent } from "@/core/discovery/types";

function event(partial: Partial<HackathonEvent> & Pick<HackathonEvent, "name" | "source">): HackathonEvent {
  return {
    themes: [],
    evidence: [],
    ...partial,
  };
}

describe("mergeCrossSourceEvents", () => {
  it("merges HackList + official web result into one event with combined evidence", () => {
    const result = mergeCrossSourceEvents([
      event({
        name: "Toronto AI Hackathon",
        source: "hacklist",
        city: "Toronto",
        country: "Canada",
        startDate: "2026-09-13",
        officialUrl: "https://hacklist.example/card/1",
        evidence: [{ type: "source_card", url: "https://hacklist.example/card/1" }],
        sourceIds: { hacklist: "1" },
      }),
      event({
        name: "Toronto AI Hackathon",
        source: "web",
        city: "Toronto",
        country: "Canada",
        startDate: "2026-09-13",
        officialUrl: "https://hackto.example.com/ai",
        applyUrl: "https://hackto.example.com/ai/apply",
        deadline: "2026-08-15",
        evidence: [{ type: "search_result", url: "https://hackto.example.com/ai", snippet: "Apply" }],
        sourceIds: { web: "https://hackto.example.com/ai" },
      }),
    ]);

    assert.equal(result.events.length, 1);
    assert.equal(result.mergeCount, 1);
    assert.ok(result.events[0]?.evidence.length >= 2);
    assert.ok(result.events[0]?.sourceIds?.hacklist);
    assert.ok(result.events[0]?.sourceIds?.web);
    assert.match(result.events[0]?.officialUrl ?? "", /hackto\.example\.com/);
  });

  it("merges MLH + Luma same event", () => {
    const result = mergeCrossSourceEvents([
      event({
        name: "Waterloo Builders Weekend",
        source: "mlh",
        city: "Waterloo",
        startDate: "2026-09-12",
        officialUrl: "https://events.mlh.io/events/111",
        evidence: [{ type: "source_card", url: "https://events.mlh.io/events/111" }],
        sourceIds: { mlh: "111" },
      }),
      event({
        name: "Waterloo Builders Weekend",
        source: "luma",
        city: "Waterloo",
        startDate: "2026-09-12",
        officialUrl: "https://lu.ma/waterloo-builders",
        evidence: [{ type: "source_card", url: "https://lu.ma/waterloo-builders" }],
        sourceIds: { luma: "waterloo-builders" },
      }),
    ]);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]?.source, "mlh");
    assert.ok(result.events[0]?.sourceIds?.mlh && result.events[0]?.sourceIds?.luma);
  });

  it("keeps same name different year separate", () => {
    const result = mergeCrossSourceEvents([
      event({
        name: "HackTO",
        source: "mlh",
        city: "Toronto",
        startDate: "2025-09-13",
      }),
      event({
        name: "HackTO",
        source: "web",
        city: "Toronto",
        startDate: "2026-09-13",
      }),
    ]);
    assert.equal(result.events.length, 2);
  });

  it("keeps same name different city separate", () => {
    const result = mergeCrossSourceEvents([
      event({
        name: "Cloud Hack",
        source: "mlh",
        city: "Toronto",
        startDate: "2026-10-01",
      }),
      event({
        name: "Cloud Hack",
        source: "luma",
        city: "Waterloo",
        startDate: "2026-10-01",
      }),
    ]);
    assert.equal(result.events.length, 2);
  });

  it("lets stronger deadline replace weak/unknown deadline", () => {
    const merged = mergeHackathonEventPair(
      event({
        name: "Event",
        source: "web",
        deadline: "soon",
      }),
      event({
        name: "Event",
        source: "mlh",
        deadline: "2026-08-15",
      }),
    );
    assert.equal(merged.deadline, "2026-08-15");
  });

  it("merges title variants with punctuation / year suffixes", () => {
    const result = mergeCrossSourceEvents([
      event({
        name: "Hack the North",
        source: "mlh",
        city: "Waterloo",
        startDate: "2026-09-12",
        officialUrl: "https://events.mlh.io/events/hack-the-north",
        evidence: [{ type: "source_card", url: "https://events.mlh.io/events/hack-the-north" }],
        sourceIds: { mlh: "htn" },
      }),
      event({
        name: "Hack the North 2026!",
        source: "web",
        city: "Waterloo",
        startDate: "2026-09-12",
        officialUrl: "https://hackthenorth.com/",
        evidence: [{ type: "search_result", url: "https://hackthenorth.com/" }],
        sourceIds: { web: "htn-web" },
      }),
    ]);
    assert.equal(result.events.length, 1);
    assert.equal(result.mergeCount, 1);
  });

  it("merges HackList event rediscovered via web", () => {
    const result = mergeCrossSourceEvents([
      event({
        name: "Slack Agent Builder Challenge",
        source: "hacklist",
        city: "Remote",
        mode: "online",
        startDate: "2026-08-01",
        officialUrl: "https://slack.example.com/agent-challenge",
        evidence: [{ type: "source_card", url: "https://hacklist.example/card" }],
        sourceIds: { hacklist: "slack" },
      }),
      event({
        name: "Slack Agent Builder Challenge",
        source: "web",
        city: "Remote",
        mode: "online",
        startDate: "2026-08-01",
        officialUrl: "https://slack.example.com/agent-challenge",
        evidence: [{ type: "search_result", url: "https://slack.example.com/agent-challenge" }],
        sourceIds: { web: "slack" },
      }),
    ]);
    assert.equal(result.events.length, 1);
    assert.ok(result.events[0]?.sourceIds?.hacklist && result.events[0]?.sourceIds?.web);
  });

  it("merges MLH + X: primary stays mlh, X evidence attached, X cannot replace officialUrl", () => {
    const mlhOfficial = "https://events.mlh.io/events/42";
    const result = mergeCrossSourceEvents([
      event({
        name: "Toronto Agent Cup",
        source: "mlh",
        city: "Toronto",
        country: "Canada",
        startDate: "2026-09-13",
        deadline: "2026-08-01",
        officialUrl: mlhOfficial,
        applyUrl: "https://events.mlh.io/events/42/register",
        evidence: [{ type: "source_card", url: mlhOfficial }],
        sourceIds: { mlh: "42" },
      }),
      event({
        name: "Toronto Agent Cup",
        source: "x",
        city: "Toronto",
        country: "Canada",
        startDate: "2026-09-13",
        officialUrl: "https://random-blog.example.com/maybe-related",
        socialUrl: "https://x.com/org/status/123",
        evidence: [
          {
            type: "x_post",
            url: "https://x.com/org/status/123",
            snippet: "Apply to Toronto Agent Cup!",
          },
        ],
        sourceIds: { x: "123" },
      }),
    ]);

    assert.equal(result.events.length, 1);
    assert.equal(result.mergeCount, 1);
    assert.equal(result.events[0]?.source, "mlh");
    assert.equal(result.events[0]?.officialUrl, mlhOfficial);
    assert.equal(result.events[0]?.sourceIds?.mlh, "42");
    assert.equal(result.events[0]?.sourceIds?.x, "123");
    assert.ok(
      result.events[0]?.evidence.some(
        (item) => item.type === "x_post" && item.url === "https://x.com/org/status/123",
      ),
    );
    assert.ok(result.events[0]?.evidence.some((item) => item.type === "source_card"));
  });

  it("merges multiple X posts into one event evidence list and sourceIds", () => {
    const result = mergeCrossSourceEvents([
      event({
        name: "Waterloo Build Night",
        source: "x",
        city: "Waterloo",
        startDate: "2026-10-05",
        socialUrl: "https://x.com/a/status/111",
        evidence: [{ type: "x_post", url: "https://x.com/a/status/111", snippet: "post 1" }],
        sourceIds: { x: "111" },
      }),
      event({
        name: "Waterloo Build Night",
        source: "x",
        city: "Waterloo",
        startDate: "2026-10-05",
        socialUrl: "https://x.com/b/status/222",
        evidence: [{ type: "x_post", url: "https://x.com/b/status/222", snippet: "post 2" }],
        sourceIds: { x: "222" },
      }),
    ]);

    assert.equal(result.events.length, 1);
    assert.equal(result.mergeCount, 1);
    const xIds = result.events[0]?.sourceIds?.x;
    assert.ok(Array.isArray(xIds));
    assert.deepEqual([...(xIds as string[])].sort(), ["111", "222"]);
    const xPosts = result.events[0]?.evidence.filter((item) => item.type === "x_post") ?? [];
    assert.equal(xPosts.length, 2);
  });

  it("lets X fill a missing deadline on a stronger source", () => {
    const merged = mergeHackathonEventPair(
      event({
        name: "Sparse MLH Event",
        source: "mlh",
        city: "Toronto",
        startDate: "2026-09-13",
        officialUrl: "https://events.mlh.io/events/9",
      }),
      event({
        name: "Sparse MLH Event",
        source: "x",
        city: "Toronto",
        startDate: "2026-09-13",
        deadline: "2026-08-20",
        socialUrl: "https://x.com/org/status/9",
      }),
    );
    assert.equal(merged.source, "mlh");
    assert.equal(merged.deadline, "2026-08-20");
  });

  it("blocks X from overwriting a stronger ISO deadline with another guess", () => {
    const merged = mergeHackathonEventPair(
      event({
        name: "Guarded Event",
        source: "mlh",
        deadline: "2026-08-01",
        startDate: "2026-09-13",
        city: "Toronto",
      }),
      event({
        name: "Guarded Event",
        source: "x",
        deadline: "2026-09-30",
        startDate: "2026-10-01",
        city: "Toronto",
      }),
    );
    assert.equal(merged.deadline, "2026-08-01");
    assert.equal(merged.startDate, "2026-09-13");
  });

  it("blocks X-first merge order from keeping weaker dates over MLH", () => {
    const merged = mergeHackathonEventPair(
      event({
        name: "Order Event",
        source: "x",
        deadline: "2026-09-30",
        startDate: "2026-10-01",
        city: "Toronto",
        socialUrl: "https://x.com/org/status/1",
      }),
      event({
        name: "Order Event",
        source: "mlh",
        deadline: "2026-08-01",
        startDate: "2026-09-13",
        city: "Toronto",
        officialUrl: "https://events.mlh.io/events/1",
      }),
    );
    assert.equal(merged.source, "mlh");
    assert.equal(merged.deadline, "2026-08-01");
    assert.equal(merged.startDate, "2026-09-13");
  });

  it("prefers web over x as primary source when merging", () => {
    const result = mergeCrossSourceEvents([
      event({
        name: "Cloud Agents Jam",
        source: "x",
        city: "Toronto",
        startDate: "2026-11-01",
        socialUrl: "https://x.com/org/status/77",
        evidence: [{ type: "x_post", url: "https://x.com/org/status/77" }],
        sourceIds: { x: "77" },
      }),
      event({
        name: "Cloud Agents Jam",
        source: "web",
        city: "Toronto",
        startDate: "2026-11-01",
        officialUrl: "https://agents.example.com/jam",
        evidence: [{ type: "search_result", url: "https://agents.example.com/jam" }],
        sourceIds: { web: "https://agents.example.com/jam" },
      }),
    ]);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]?.source, "web");
    assert.ok(result.events[0]?.sourceIds?.x);
    assert.ok(result.events[0]?.sourceIds?.web);
  });

  it("does not create a duplicate solely because the same event was found on X", () => {
    const official = "https://hackto.example.com/ai";
    const result = mergeCrossSourceEvents([
      event({
        name: "HackTO AI Challenge",
        source: "web",
        city: "Toronto",
        startDate: "2026-09-13",
        officialUrl: official,
        evidence: [{ type: "search_result", url: official }],
        sourceIds: { web: official },
      }),
      event({
        name: "HackTO AI Challenge",
        source: "x",
        city: "Toronto",
        startDate: "2026-09-13",
        officialUrl: official,
        socialUrl: "https://x.com/hackto/status/999",
        evidence: [{ type: "x_post", url: "https://x.com/hackto/status/999" }],
        sourceIds: { x: "999" },
      }),
    ]);
    assert.equal(result.events.length, 1);
    assert.equal(result.mergeCount, 1);
  });
});

describe("mergeSourceIds", () => {
  it("accumulates multiple X post IDs without dropping earlier ones", () => {
    assert.deepEqual(mergeSourceIds({ x: "1", mlh: "a" }, { x: "2" }), {
      x: ["1", "2"],
      mlh: "a",
    });
    assert.deepEqual(mergeSourceIds({ x: ["1", "2"] }, { x: "2" }), {
      x: ["1", "2"],
    });
  });
});
