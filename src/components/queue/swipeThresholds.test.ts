import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SWIPE_THRESHOLDS } from "@/components/queue/SwipeDeck";

describe("swipe thresholds", () => {
  it("requires intentional horizontal movement before decide", () => {
    assert.equal(SWIPE_THRESHOLDS.horizontal, 110);
    assert.ok(SWIPE_THRESHOLDS.horizontal > 80);
  });

  it("does not expose an upward save swipe threshold", () => {
    assert.equal(
      "save" in SWIPE_THRESHOLDS,
      false,
      "save is keyboard/menu only — no upward swipe",
    );
  });
});
