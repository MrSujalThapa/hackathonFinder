import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { broadNeedsReviewReasons } from "@/discovery/pipeline";
import type { ScoringResult } from "@/core/discovery/types";

function score(overrides: Partial<ScoringResult> = {}): ScoringResult {
  return {
    score: 80,
    whyMatch: ["Theme match"],
    redFlags: [],
    rejected: false,
    ...overrides,
  };
}

describe("broadNeedsReviewReasons", () => {
  it("does not force review solely for a missing application deadline", () => {
    const reasons = broadNeedsReviewReasons(
      {
        startDate: "2026-09-01",
        officialUrl: "https://event.example",
        applyUrl: "https://event.example/apply",
      },
      score({ redFlags: ["Applications close: Unknown"] }),
    );
    assert.deepEqual(reasons, []);
  });

  it("still reviews when the event date is unclear", () => {
    const reasons = broadNeedsReviewReasons(
      {
        officialUrl: "https://event.example",
        applyUrl: "https://event.example/apply",
      },
      score({ redFlags: ["Applications close: Unknown"] }),
    );
    assert.ok(reasons.includes("Event date unclear"));
  });

  it("still reviews when official URL is missing", () => {
    const reasons = broadNeedsReviewReasons(
      {
        startDate: "2026-09-01",
        applyUrl: "https://event.example/apply",
      },
      score(),
    );
    assert.ok(reasons.includes("Official URL missing or unclear"));
  });
});
