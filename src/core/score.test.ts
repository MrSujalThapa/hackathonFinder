import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiscoveryPreferences, HackathonEvent } from "@/core/discovery/types";
import { getDefaultDiscoveryPreferences } from "@/agent/parseCommand";
import { evaluateEligibility, scoreHackathonEvent } from "./score";

const NOW = new Date("2026-07-11T12:00:00Z");

const basePreferences: DiscoveryPreferences = {
  ...getDefaultDiscoveryPreferences("find upcoming AI hackathons in Canada or remote"),
  locations: ["Toronto", "Waterloo", "Canada", "Remote"],
  themes: ["AI", "agents"],
  includeRemote: true,
  includeInPerson: true,
  dateFrom: "2026-07-01",
  dateTo: "2026-12-31",
};

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
    startDate: "2026-09-13",
    prize: "$5,000",
    eligibility: "Open to students",
    ...overrides,
  };
}

describe("eligibility vs ranking", () => {
  it("lets a Hack the North-like Canada event pass eligibility without AI theme", () => {
    const htN = event({
      name: "Hack the North 2026",
      themes: [],
      city: "Waterloo",
      country: "Canada",
      officialUrl: "https://hackthenorth.com",
      applyUrl: "https://hackthenorth.com/apply",
      startDate: "2026-09-12",
      deadline: "2026-08-01",
    });
    const eligibility = evaluateEligibility(htN, basePreferences, { now: NOW });
    assert.equal(eligibility.eligible, true);
    const scored = scoreHackathonEvent(htN, basePreferences, { now: NOW });
    assert.equal(scored.rejected, false);
    assert.ok(scored.score >= 40);
  });

  it("allows a remote non-AI hackathon with lower ranking", () => {
    const remote = event({
      name: "Cloud Builders Weekend",
      themes: ["cloud"],
      city: "Remote",
      country: "Online",
      mode: "online",
      location: "Online",
    });
    const scored = scoreHackathonEvent(remote, basePreferences, { now: NOW });
    assert.equal(scored.rejected, false);
  });

  it("rejects unrelated in-person events outside requested geography", () => {
    const tokyo = event({
      name: "Tokyo Robotics Fair",
      city: "Tokyo",
      country: "Japan",
      mode: "in-person",
      themes: ["robotics"],
    });
    const scored = scoreHackathonEvent(tokyo, basePreferences, { now: NOW });
    assert.equal(scored.rejected, true);
    assert.match(scored.rejectionReason ?? "", /location|geography/i);
  });

  it("rejects closed registration even if the event starts later", () => {
    const closed = event({
      deadline: "2026-07-10",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
    });
    const scored = scoreHackathonEvent(closed, basePreferences, { now: NOW });
    assert.equal(scored.rejected, true);
    assert.match(scored.rejectionReason ?? "", /deadline|registration/i);
  });

  it("rejects stale 2025 title years during 2026", () => {
    const stale = event({
      name: "AI Agents Hackathon 2025",
      startDate: "2025-05-01",
      endDate: "2025-05-03",
      deadline: "2025-04-01",
    });
    const scored = scoreHackathonEvent(stale, basePreferences, { now: NOW });
    assert.equal(scored.rejected, true);
  });
});
