import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiscoveryPreferences, HackathonEvent } from "@/core/discovery/types";
import { getDefaultDiscoveryPreferences } from "@/agent/parseCommand";
import { scoreHackathonEvent } from "./score";

const basePreferences: DiscoveryPreferences = getDefaultDiscoveryPreferences(
  "find upcoming hackathons",
);

function event(overrides: Partial<HackathonEvent>): HackathonEvent {
  return {
    name: "Test Hackathon",
    source: "mock",
    themes: ["AI"],
    evidence: [],
    city: "Toronto",
    country: "Canada",
    mode: "in-person",
    officialUrl: "https://example.com/event",
    applyUrl: "https://example.com/apply",
    deadline: "2026-08-15",
    prize: "$5,000",
    eligibility: "Open to students",
    ...overrides,
  };
}

describe("scoreHackathonEvent", () => {
  it("scores a strong Toronto AI event highly", () => {
    const result = scoreHackathonEvent(event({ name: "HackTO AI Challenge" }), basePreferences);
    assert.equal(result.rejected, false);
    assert.ok(result.score >= 55);
    assert.ok(result.whyMatch.length > 0);
  });

  it("rejects clearly past events", () => {
    const result = scoreHackathonEvent(
      event({
        name: "Past Hackathon",
        deadline: "2020-01-01",
        endDate: "2020-01-02",
      }),
      basePreferences,
    );
    assert.equal(result.rejected, true);
    assert.match(result.rejectionReason ?? "", /ended/i);
  });

  it("rejects events without useful URLs", () => {
    const result = scoreHackathonEvent(
      event({
        name: "No URL Event",
        officialUrl: undefined,
        applyUrl: undefined,
        socialUrl: undefined,
      }),
      basePreferences,
    );
    assert.equal(result.rejected, true);
    assert.match(result.rejectionReason ?? "", /url/i);
  });

  it("penalizes irrelevant far-away in-person events", () => {
    const result = scoreHackathonEvent(
      event({
        name: "Random Robotics Fair",
        city: "Tokyo",
        country: "Japan",
        mode: "in-person",
        themes: ["robotics"],
        officialUrl: "https://tokyo.example.com",
        applyUrl: "https://tokyo.example.com/apply",
      }),
      basePreferences,
    );
    assert.equal(result.rejected, true);
  });
});
