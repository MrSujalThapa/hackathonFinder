import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCommand } from "@/agent/parseCommand";
import {
  classifyExplicitCityLocation,
  hasExplicitCityConstraint,
} from "@/core/locationConstraints";
import type { HackathonEvent } from "@/core/discovery/types";

function event(partial: Partial<HackathonEvent>): HackathonEvent {
  return {
    name: partial.name ?? "Sample Hack",
    source: partial.source ?? "mlh",
    description: partial.description ?? "",
    location: partial.location,
    city: partial.city,
    country: partial.country,
    mode: partial.mode ?? "unknown",
    themes: partial.themes ?? [],
    startDate: partial.startDate,
    endDate: partial.endDate,
    applicationDeadline: partial.applicationDeadline,
    submissionDeadline: partial.submissionDeadline,
    officialUrl: partial.officialUrl ?? "https://example.com/hack",
    applyUrl: partial.applyUrl,
    evidence: partial.evidence ?? [],
    sourceIds: partial.sourceIds ?? { mlh: "sample" },
    eventLocation: partial.eventLocation,
  };
}

describe("San Francisco location constraint", () => {
  it("normalizes San Francisco aliases and excludes remote by default", () => {
    for (const command of [
      "find upcoming hackathons in San Francisco",
      "find upcoming hackathons in SF",
      "find upcoming hackathons in the Bay Area",
    ]) {
      const prefs = parseCommand(command);
      assert.ok(prefs.locations.includes("San Francisco"), command);
      assert.equal(prefs.locationConstraint, "event_location", command);
      assert.equal(prefs.remotePolicy, "exclude", command);
      assert.equal(hasExplicitCityConstraint(prefs), true, command);
    }
  });

  it("includes remote when San Francisco or remote is requested", () => {
    const prefs = parseCommand("find upcoming hackathons in San Francisco or remote");
    assert.ok(prefs.locations.includes("San Francisco"));
    assert.equal(prefs.locationConstraint, "event_location");
    assert.equal(prefs.remotePolicy, "include");
  });

  it("rejects unrelated California cities and broad region text", () => {
    const prefs = parseCommand("find upcoming hackathons in San Francisco");
    const losAngeles = classifyExplicitCityLocation(
      event({ location: "Los Angeles, California", mode: "in-person" }),
      prefs,
    );
    assert.equal(losAngeles.eligible, false);

    const californiaOnly = classifyExplicitCityLocation(
      event({ location: "California, United States", mode: "in-person" }),
      prefs,
    );
    assert.equal(californiaOnly.eligible, false);
    assert.match(californiaOnly.reason, /Broad California\/US|mismatch/i);

    const usaOnly = classifyExplicitCityLocation(
      event({ location: "United States", mode: "in-person" }),
      prefs,
    );
    assert.equal(usaOnly.eligible, false);

    const sfMatch = classifyExplicitCityLocation(
      event({ location: "San Francisco, CA", mode: "in-person" }),
      prefs,
    );
    assert.equal(sfMatch.eligible, true);
    assert.equal(sfMatch.status, "EXACT_MATCH");
  });
});
