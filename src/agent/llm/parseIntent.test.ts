import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseIntent } from "./parseIntent";

describe("parseIntent", () => {
  it("parses hackathon discovery commands through the deterministic parser", () => {
    const intent = parseIntent("find AI hackathons near Waterloo on x");

    assert.equal(intent.kind, "discover_hackathons");
    if (intent.kind === "discover_hackathons") {
      assert.ok(intent.preferences.themes.includes("AI"));
      assert.ok(intent.preferences.locations.includes("Waterloo"));
      assert.ok(intent.preferences.sources.includes("x"));
    }
  });

  it("returns unknown for empty commands", () => {
    const intent = parseIntent("   ");

    assert.equal(intent.kind, "unknown");
    assert.equal(intent.confidence, 0);
  });
});
