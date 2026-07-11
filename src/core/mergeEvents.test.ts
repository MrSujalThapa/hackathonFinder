import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeCrossSourceEvents, mergeHackathonEventPair } from "@/core/mergeEvents";
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

  it("persists evidence from both sources", () => {
    const merged = mergeHackathonEventPair(
      event({
        name: "Event",
        source: "hacklist",
        evidence: [{ type: "source_card", url: "https://a.example" }],
      }),
      event({
        name: "Event",
        source: "web",
        evidence: [{ type: "search_result", url: "https://b.example", snippet: "x" }],
      }),
    );
    assert.equal(merged.evidence.length, 2);
  });
});
