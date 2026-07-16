import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCommand } from "./parseCommand";

describe("parseCommand", () => {
  it("parses basic find command with defaults", () => {
    const prefs = parseCommand("find upcoming hackathons");
    assert.deepEqual(prefs.locations, []);
    assert.deepEqual(prefs.themes, []);
    assert.equal(prefs.locationConstraint, "none");
    assert.equal(prefs.remotePolicy, "include");
    assert.deepEqual(prefs.sources, ["hacklist", "mlh", "luma", "web"]);
    assert.equal(prefs.maxResults, 100);
    assert.equal(prefs.reviewPolicy, "broad");
    assert.ok(prefs.dateFrom);
    assert.ok(prefs.dateTo);
  });

  it("supports /find alias and Toronto location", () => {
    const prefs = parseCommand("/find hackathons in Toronto");
    assert.ok(prefs.locations.includes("Toronto"));
    assert.equal(prefs.locationConstraint, "event_location");
    assert.equal(prefs.remotePolicy, "exclude");
  });

  it("parses San Francisco city queries with default remote exclusion", () => {
    const prefs = parseCommand("find upcoming hackathons in San Francisco");
    assert.ok(prefs.locations.includes("San Francisco"));
    assert.equal(prefs.locationConstraint, "event_location");
    assert.equal(prefs.remotePolicy, "exclude");
  });

  it("parses SF aliases and San Francisco or remote inclusion", () => {
    const sf = parseCommand("find upcoming hackathons in SF");
    assert.ok(sf.locations.includes("San Francisco"));
    assert.equal(sf.remotePolicy, "exclude");

    const bay = parseCommand("find upcoming hackathons in the Bay Area");
    assert.ok(bay.locations.includes("San Francisco"));
    assert.equal(bay.locationConstraint, "event_location");

    const withRemote = parseCommand("find upcoming hackathons in San Francisco or remote");
    assert.ok(withRemote.locations.includes("San Francisco"));
    assert.equal(withRemote.remotePolicy, "include");
  });

  it("parses next-N-months ranges before the generic upcoming horizon", () => {
    const three = parseCommand("find upcoming hackathons in the next 3 months");
    assert.ok(three.dateFrom);
    assert.ok(three.dateTo);
    const from = new Date(three.dateFrom!);
    const to = new Date(three.dateTo!);
    const months =
      (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
    assert.equal(months, 3);

    const six = parseCommand(
      "find hackathons that people in Canada are eligible for in the next 6 months",
    );
    assert.ok(six.dateFrom);
    assert.ok(six.dateTo);
    const from6 = new Date(six.dateFrom!);
    const to6 = new Date(six.dateTo!);
    const months6 =
      (to6.getUTCFullYear() - from6.getUTCFullYear()) * 12 +
      (to6.getUTCMonth() - from6.getUTCMonth());
    assert.equal(months6, 6);

    const upcomingOnly = parseCommand("find upcoming hackathons");
    const upFrom = new Date(upcomingOnly.dateFrom!);
    const upTo = new Date(upcomingOnly.dateTo!);
    const upMonths =
      (upTo.getUTCFullYear() - upFrom.getUTCFullYear()) * 12 +
      (upTo.getUTCMonth() - upFrom.getUTCMonth());
    assert.equal(upMonths, 6);

    const explicit = parseCommand(
      "find upcoming hackathons from 2026-07-01 to 2026-08-31 in the next 3 months",
    );
    assert.equal(explicit.dateFrom, "2026-07-01");
    assert.equal(explicit.dateTo, "2026-08-31");
  });

  it("parses explicit date range via search alias", () => {
    const prefs = parseCommand(
      "search hackathons in Toronto from 2026-07-01 to 2026-08-31",
    );
    assert.equal(prefs.dateFrom, "2026-07-01");
    assert.equal(prefs.dateTo, "2026-08-31");
    assert.ok(prefs.locations.includes("Toronto"));
  });

  it("parses AI agent themes and Waterloo near-remote hints", () => {
    const prefs = parseCommand(
      "find AI agent hackathons remote or near Waterloo",
    );
    assert.ok(prefs.themes.includes("AI"));
    assert.ok(prefs.themes.includes("agents"));
    assert.ok(prefs.locations.includes("Waterloo"));
    assert.ok(prefs.includeRemote);
    assert.ok(prefs.modes.includes("online"));
  });

  it("distinguishes remote inclusion and participant eligibility", () => {
    const torontoRemote = parseCommand("find AI hackathons in Toronto or remote");
    assert.equal(torontoRemote.locationConstraint, "event_location");
    assert.equal(torontoRemote.remotePolicy, "include");

    const eligibility = parseCommand(
      "find AI hackathons that people in Canada are eligible for in the next 2 months",
    );
    assert.equal(eligibility.locationConstraint, "participant_eligibility");
    assert.equal(eligibility.remotePolicy, "inferred_open");
    assert.ok(eligibility.locations.includes("Canada"));

    const remoteOnly = parseCommand("find remote AI hackathons");
    assert.equal(remoteOnly.locationConstraint, "none");
    assert.equal(remoteOnly.remotePolicy, "only");
  });

  it("parses source hints without enabling real collectors", () => {
    const prefs = parseCommand("find hackathons on devpost and x");
    assert.ok(prefs.sources.includes("devpost"));
    assert.ok(prefs.sources.includes("x"));
  });
});
