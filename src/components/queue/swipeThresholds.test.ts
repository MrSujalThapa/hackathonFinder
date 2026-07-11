import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SWIPE_THRESHOLDS } from "@/components/queue/SwipeDeck";

describe("swipe thresholds", () => {
  it("requires intentional horizontal movement before decide", () => {
    assert.equal(SWIPE_THRESHOLDS.horizontal, 110);
    assert.ok(SWIPE_THRESHOLDS.horizontal > 80);
  });

  it("uses a dedicated upward save threshold", () => {
    assert.equal(SWIPE_THRESHOLDS.save, 90);
    assert.ok(SWIPE_THRESHOLDS.save > 50);
  });
});
