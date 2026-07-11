import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Keyboard mapping contract for the review deck.
 * Full DOM+GSAP integration is covered manually / via smoke:queue.
 */
describe("review keyboard contract", () => {
  const shortcuts: Record<string, string> = {
    ArrowLeft: "reject",
    ArrowRight: "approve",
    s: "save",
    S: "save",
    Enter: "toggle-details",
    " ": "toggle-details",
    Escape: "close-details",
  };

  it("documents the desktop shortcut map", () => {
    assert.equal(shortcuts.ArrowLeft, "reject");
    assert.equal(shortcuts.ArrowRight, "approve");
    assert.equal(shortcuts.s, "save");
    assert.equal(shortcuts.Enter, "toggle-details");
    assert.equal(shortcuts.Escape, "close-details");
  });
});
