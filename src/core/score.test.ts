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

const torontoPreferences: DiscoveryPreferences = {
  ...getDefaultDiscoveryPreferences("find upcoming hackathons in Toronto"),
  locations: ["Toronto"],
  themes: ["AI"],
  includeRemote: true,
  includeInPerson: true,
  dateFrom: "2026-07-13",
  dateTo: "2026-12-31",
};

const waterlooPreferences: DiscoveryPreferences = {
  ...getDefaultDiscoveryPreferences("find upcoming hackathons in Waterloo"),
  locations: ["Waterloo"],
  themes: ["AI"],
  includeRemote: true,
  includeInPerson: true,
  dateFrom: "2026-07-13",
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

  it("keeps unrelated in-person events outside requested geography for broad review", () => {
    const tokyo = event({
      name: "Tokyo Robotics Fair",
      city: "Tokyo",
      country: "Japan",
      mode: "in-person",
      themes: ["robotics"],
    });
    const scored = scoreHackathonEvent(tokyo, basePreferences, { now: NOW });
    assert.equal(scored.rejected, false);
    assert.ok(scored.redFlags.some((flag) => /geography/i.test(flag)));
  });

  it("still rejects explicit geography violations in strict review", () => {
    const tokyo = event({
      name: "Tokyo Robotics Fair",
      city: "Tokyo",
      country: "Japan",
      mode: "in-person",
      themes: ["robotics"],
    });
    const scored = scoreHackathonEvent(
      tokyo,
      { ...basePreferences, reviewPolicy: "strict" },
      { now: NOW },
    );
    assert.equal(scored.rejected, true);
    assert.match(scored.rejectionReason ?? "", /location|geography/i);
  });

  it("does not reject low relevance alone in broad review", () => {
    const lowRelevance = event({
      name: "Founders Demo Night",
      source: "luma",
      themes: ["startup"],
      description: "A founder demo and builder networking event.",
      prize: undefined,
      eligibility: undefined,
    });
    const scored = scoreHackathonEvent(lowRelevance, basePreferences, { now: NOW });
    assert.equal(scored.rejected, false);
  });

  it("keeps incomplete metadata for broad review", () => {
    const incomplete = event({
      name: "Toronto Builder Meetup",
      source: "hakku",
      applyUrl: undefined,
      officialUrl: undefined,
      deadline: undefined,
      startDate: undefined,
      prize: undefined,
      eligibility: undefined,
    });
    const scored = scoreHackathonEvent(incomplete, basePreferences, { now: NOW });
    assert.equal(scored.rejected, false);
    assert.ok(scored.redFlags.some((flag) => /official|apply/i.test(flag)));
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

  it("keeps an ongoing event for an upcoming query", () => {
    const ongoing = event({
      startDate: "2026-07-11",
      endDate: "2026-07-18",
      deadline: undefined,
    });
    const scored = scoreHackathonEvent(ongoing, torontoPreferences, {
      now: new Date("2026-07-13T12:00:00Z"),
    });
    assert.equal(scored.rejected, false);
  });

  it("rejects confirmed in-person India events for explicit Toronto queries", () => {
    const india = event({
      name: "Find hackathonsworth your time",
      city: "Bilaspur",
      country: "India",
      location: "Bilaspur, Chhattisgarh, India",
      mode: "in-person",
      startDate: "2026-07-11",
      endDate: "2026-07-18",
      deadline: undefined,
    });
    const scored = scoreHackathonEvent(india, torontoPreferences, {
      now: new Date("2026-07-13T12:00:00Z"),
    });
    assert.equal(scored.rejected, true);
    assert.match(scored.rejectionReason ?? "", /Location mismatch/i);
  });

  it("keeps virtual events for explicit Toronto queries", () => {
    const virtual = event({
      city: "Bilaspur",
      country: "India",
      location: "Online",
      mode: "online",
    });
    const scored = scoreHackathonEvent(virtual, torontoPreferences, { now: NOW });
    assert.equal(scored.rejected, false);
  });

  it("keeps Waterloo in-person events for explicit Waterloo queries", () => {
    const waterloo = event({
      city: "Waterloo",
      country: "Canada",
      location: "Waterloo, Ontario",
      mode: "in-person",
    });
    const scored = scoreHackathonEvent(waterloo, waterlooPreferences, { now: NOW });
    assert.equal(scored.rejected, false);
  });

  it("rejects Toronto in-person events for explicit Waterloo queries", () => {
    const toronto = event({
      city: "Toronto",
      country: "Canada",
      location: "Toronto, Ontario",
      mode: "in-person",
    });
    const scored = scoreHackathonEvent(toronto, waterlooPreferences, { now: NOW });
    assert.equal(scored.rejected, true);
    assert.match(scored.rejectionReason ?? "", /Waterloo/i);
  });

  it("keeps unknown locations for explicit Waterloo queries as needs review", () => {
    const unknown = event({
      city: undefined,
      country: undefined,
      location: undefined,
      mode: "unknown",
    });
    const scored = scoreHackathonEvent(unknown, waterlooPreferences, { now: NOW });
    assert.equal(scored.rejected, false);
    assert.ok(scored.redFlags.some((flag) => /Location unclear/i.test(flag)));
  });

  it("clamps discovery relevance to 100", () => {
    const high = event({
      themes: ["AI", "agents", "cloud", "developer tools"],
      mode: "online",
      location: "Toronto and online",
      prize: "$100,000",
      eligibility: "Open to students",
    });
    const scored = scoreHackathonEvent(high, basePreferences, { now: NOW });
    assert.equal(scored.rejected, false);
    assert.ok(scored.score <= 100);
  });
});
