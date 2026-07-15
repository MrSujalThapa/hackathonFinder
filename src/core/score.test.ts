import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiscoveryPreferences, HackathonEvent } from "@/core/discovery/types";
import { parseCommand } from "@/agent/parseCommand";
import { evaluateEligibility, scoreHackathonEvent } from "./score";

const NOW = new Date("2026-07-11T12:00:00Z");

const basePreferences: DiscoveryPreferences = {
  ...parseCommand("find upcoming AI hackathons in Canada or remote"),
  dateFrom: "2026-07-01",
  dateTo: "2026-12-31",
};

const torontoPreferences: DiscoveryPreferences = {
  ...parseCommand("find upcoming AI hackathons in Toronto"),
  dateFrom: "2026-07-13",
  dateTo: "2026-12-31",
};

const waterlooPreferences: DiscoveryPreferences = {
  ...parseCommand("find upcoming AI hackathons in Waterloo"),
  dateFrom: "2026-07-13",
  dateTo: "2026-12-31",
};

const gtaPreferences: DiscoveryPreferences = {
  ...parseCommand("find upcoming AI hackathons in GTA"),
  dateFrom: "2026-07-13",
  dateTo: "2026-12-31",
};

const eligibilityPreferences: DiscoveryPreferences = {
  ...parseCommand("find AI hackathons that people in Canada are eligible for in the next 2 months"),
  dateFrom: "2026-07-13",
  dateTo: "2026-12-31",
};

const remoteOnlyPreferences: DiscoveryPreferences = {
  ...parseCommand("find remote AI hackathons"),
  dateFrom: "2026-07-13",
  dateTo: "2026-12-31",
};

const onsiteOnlyPreferences: DiscoveryPreferences = {
  ...parseCommand("find onsite AI hackathons"),
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
    registrationDeadline: "2026-08-15",
    deadline: "2026-08-15",
    eventStartDate: "2026-09-13",
    eventEndDate: "2026-09-13",
    startDate: "2026-09-13",
    endDate: "2026-09-13",
    prize: "$5,000",
    eligibility: "Open to students",
    ...overrides,
  };
}

describe("eligibility vs ranking", () => {
  it("rejects a Canada event without requested AI theme", () => {
    const htN = event({
      name: "Hack the North 2026",
      themes: [],
      description: "Student hackathon weekend.",
      city: "Waterloo",
      country: "Canada",
      officialUrl: "https://hackthenorth.com",
      applyUrl: "https://hackthenorth.com/apply",
      startDate: "2026-09-12",
      deadline: "2026-08-01",
    });
    const eligibility = evaluateEligibility(htN, basePreferences, { now: NOW });
    assert.equal(eligibility.eligible, false);
    const scored = scoreHackathonEvent(htN, basePreferences, { now: NOW });
    assert.equal(scored.rejected, true);
    assert.match(scored.rejectionReason ?? "", /Theme/i);
  });

  it("rejects a remote non-AI hackathon for an AI query", () => {
    const remote = event({
      name: "Cloud Builders Hackathon",
      themes: ["cloud"],
      city: "Remote",
      country: "Online",
      mode: "online",
      location: "Online",
    });
    const scored = scoreHackathonEvent(remote, basePreferences, { now: NOW });
    assert.equal(scored.rejected, true);
  });

  it("rejects unrelated in-person events outside requested geography", () => {
    const tokyo = event({
      name: "Tokyo AI Robotics Hackathon",
      city: "Tokyo",
      country: "Japan",
      mode: "in-person",
      themes: ["AI", "robotics"],
    });
    const scored = scoreHackathonEvent(tokyo, basePreferences, { now: NOW });
    assert.equal(scored.rejected, true);
    assert.match(scored.rejectionReason ?? "", /location|geography/i);
  });

  it("rejects explicit geography violations in strict review", () => {
    const tokyo = event({
      name: "Tokyo AI Robotics Hackathon",
      city: "Tokyo",
      country: "Japan",
      mode: "in-person",
      themes: ["AI", "robotics"],
    });
    const scored = scoreHackathonEvent(
      tokyo,
      { ...basePreferences, reviewPolicy: "strict" },
      { now: NOW },
    );
    assert.equal(scored.rejected, true);
    assert.match(scored.rejectionReason ?? "", /location|geography/i);
  });

  it("rejects low theme relevance before scoring", () => {
    const lowRelevance = event({
      name: "Founders Startup Hackathon",
      source: "luma",
      themes: ["startup"],
      description: "A founder hackathon and builder competition.",
      prize: undefined,
      eligibility: undefined,
    });
    const scored = scoreHackathonEvent(lowRelevance, basePreferences, { now: NOW });
    assert.equal(scored.rejected, true);
    assert.match(scored.rejectionReason ?? "", /Theme/i);
  });

  it("rejects obvious non-hackathon Luma events before scoring", () => {
    const danceParty = event({
      name: "REUNION Dance Party: Open Air Rooftop Party",
      source: "luma",
      themes: ["AI"],
      description: "Toronto social event with music and networking.",
      eventStartDate: "2026-07-15",
      eventEndDate: "2026-07-16",
      startDate: "2026-07-15",
      endDate: "2026-07-16",
    });

    const scored = scoreHackathonEvent(danceParty, torontoPreferences, { now: NOW });
    assert.equal(scored.rejected, true);
    assert.match(scored.rejectionReason ?? "", /not a hackathon/i);
  });

  it("rejects generic build nights without hackathon or competition evidence", () => {
    const buildNight = event({
      name: "Superhuman Build Night",
      source: "luma",
      themes: ["AI"],
      description: "A product meetup for builders.",
      eventStartDate: "2026-07-16",
      eventEndDate: "2026-07-17",
      startDate: "2026-07-16",
      endDate: "2026-07-17",
    });

    const scored = scoreHackathonEvent(buildNight, torontoPreferences, { now: NOW });
    assert.equal(scored.rejected, true);
    assert.match(scored.rejectionReason ?? "", /not a hackathon/i);
  });

  it("rejects social/profile and date-only titles even when snippets mention hackathons", () => {
    for (const name of ["Facebook", "2026-01-01", "MLH's Top 50 Hackers"]) {
      const scored = scoreHackathonEvent(
        event({
          name,
          source: "web",
          themes: ["AI"],
          description: "A Toronto AI hackathon listing.",
        }),
        torontoPreferences,
        { now: NOW },
      );
      assert.equal(scored.rejected, true, name);
      assert.match(scored.rejectionReason ?? "", /not a hackathon/i);
    }
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
      registrationDeadline: "2026-07-10",
      deadline: "2026-07-10",
      eventStartDate: "2026-09-01",
      eventEndDate: "2026-09-03",
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
      registrationDeadline: "2026-08-01",
      eventStartDate: "2025-05-01",
      eventEndDate: "2025-05-03",
      startDate: "2025-05-01",
      endDate: "2025-05-03",
      deadline: "2026-08-01",
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
      name: "Bilaspur AI Hackathon",
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

  it("rejects virtual events for explicit Toronto queries unless remote is requested", () => {
    const virtual = event({
      city: "Bilaspur",
      country: "India",
      location: "Online",
      mode: "online",
    });
    const scored = scoreHackathonEvent(virtual, torontoPreferences, { now: NOW });
    assert.equal(scored.rejected, true);
  });

  it("allows virtual events for explicit city queries when remote is requested", () => {
    const virtual = event({
      city: "Remote",
      country: "Online",
      location: "Online",
      mode: "online",
    });
    const scored = scoreHackathonEvent(virtual, {
      ...parseCommand("find AI hackathons in Toronto or remote"),
      dateFrom: "2026-07-13",
      dateTo: "2026-12-31",
    }, { now: NOW });
    assert.equal(scored.rejected, false);
  });

  it("does not treat GTA as Toronto unless the query requested GTA", () => {
    const mississauga = event({
      city: "Mississauga",
      country: "Canada",
      location: "Mississauga, Ontario",
      mode: "in-person",
    });
    assert.equal(
      scoreHackathonEvent(mississauga, torontoPreferences, { now: NOW }).rejected,
      true,
    );
    assert.equal(
      scoreHackathonEvent(mississauga, gtaPreferences, { now: NOW }).rejected,
      false,
    );
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

  it("rejects unknown locations for explicit Waterloo queries", () => {
    const unknown = event({
      city: undefined,
      country: undefined,
      location: undefined,
      mode: "unknown",
    });
    const scored = scoreHackathonEvent(unknown, waterlooPreferences, { now: NOW });
    assert.equal(scored.rejected, true);
    assert.match(scored.rejectionReason ?? "", /Location unclear/i);
  });

  it("distinguishes participant eligibility from event location", () => {
    const globalRemote = event({
      city: "Remote",
      country: "Online",
      location: "Online",
      mode: "online",
      eligibility: "Open to builders worldwide, including Canada.",
    });
    const japanInPerson = event({
      city: "Tokyo",
      country: "Japan",
      location: "Tokyo, Japan",
      mode: "in-person",
      eligibility: "Open to local residents only.",
    });

    assert.equal(
      scoreHackathonEvent(globalRemote, eligibilityPreferences, { now: NOW }).rejected,
      false,
    );
    assert.equal(
      scoreHackathonEvent(japanInPerson, eligibilityPreferences, { now: NOW }).rejected,
      true,
    );
  });

  it("enforces remote-only and onsite-only policies", () => {
    const remote = event({
      city: "Remote",
      country: "Online",
      location: "Online",
      mode: "online",
    });
    const physical = event({
      city: "Toronto",
      country: "Canada",
      location: "Toronto, Ontario",
      mode: "in-person",
    });

    assert.equal(
      scoreHackathonEvent(remote, remoteOnlyPreferences, { now: NOW }).rejected,
      false,
    );
    assert.equal(
      scoreHackathonEvent(physical, remoteOnlyPreferences, { now: NOW }).rejected,
      true,
    );
    assert.equal(
      scoreHackathonEvent(remote, onsiteOnlyPreferences, { now: NOW }).rejected,
      true,
    );
    assert.equal(
      scoreHackathonEvent(physical, onsiteOnlyPreferences, { now: NOW }).rejected,
      false,
    );
  });

  it("rejects events outside the requested date window but reviews unknown event dates", () => {
    const beforeWindow = event({
      eventStartDate: "2026-06-01",
      eventEndDate: "2026-06-02",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
    });
    const unknownDate = event({
      eventStartDate: undefined,
      eventEndDate: undefined,
      startDate: undefined,
      endDate: undefined,
    });

    assert.equal(
      scoreHackathonEvent(beforeWindow, basePreferences, { now: NOW }).rejected,
      true,
    );
    const scoredUnknown = scoreHackathonEvent(unknownDate, basePreferences, { now: NOW });
    assert.equal(scoredUnknown.rejected, false);
    assert.ok(scoredUnknown.redFlags.some((flag) => /date/i.test(flag)));
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
