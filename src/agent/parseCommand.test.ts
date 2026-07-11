import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCommand } from "./parseCommand";

describe("parseCommand", () => {
  it("parses basic find command with defaults", () => {
    const prefs = parseCommand("find upcoming hackathons");
    assert.ok(prefs.locations.includes("Toronto"));
    assert.ok(prefs.themes.includes("AI"));
    assert.deepEqual(prefs.sources, ["hacklist", "devpost", "hakku"]);
    assert.ok(prefs.dateFrom);
    assert.ok(prefs.dateTo);
  });

  it("supports /find alias and Toronto location", () => {
    const prefs = parseCommand("/find hackathons in Toronto");
    assert.ok(prefs.locations.includes("Toronto"));
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

  it("parses source hints without enabling real collectors", () => {
    const prefs = parseCommand("find hackathons on devpost and x");
    assert.ok(prefs.sources.includes("devpost"));
    assert.ok(prefs.sources.includes("x"));
  });
});
