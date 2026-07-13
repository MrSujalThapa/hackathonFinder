import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveEventTemporalStatus } from "@/core/dates";

describe("deriveEventTemporalStatus", () => {
  const now = new Date("2026-07-13T12:00:00Z");

  it("marks an event that ended yesterday as finished", () => {
    assert.equal(
      deriveEventTemporalStatus({
        startDate: "2026-07-01",
        endDate: "2026-07-12",
        timezone: "America/Toronto",
        now,
      }),
      "FINISHED",
    );
  });

  it("marks tomorrow as upcoming", () => {
    assert.equal(
      deriveEventTemporalStatus({
        startDate: "2026-07-14",
        endDate: "2026-07-15",
        timezone: "America/Toronto",
        now,
      }),
      "UPCOMING",
    );
  });

  it("marks a multi-day active event as ongoing", () => {
    assert.equal(
      deriveEventTemporalStatus({
        startDate: "2026-07-11",
        endDate: "2026-07-18",
        timezone: "America/Toronto",
        now,
      }),
      "ONGOING",
    );
  });

  it("marks missing end date as unknown", () => {
    assert.equal(
      deriveEventTemporalStatus({
        startDate: "2026-07-11",
        timezone: "America/Toronto",
        now,
      }),
      "UNKNOWN",
    );
  });

  it("uses the event timezone for day-boundary comparisons", () => {
    const boundary = new Date("2026-07-13T02:00:00Z");

    assert.equal(
      deriveEventTemporalStatus({
        startDate: "2026-07-13",
        endDate: "2026-07-14",
        timezone: "America/Toronto",
        now: boundary,
      }),
      "UPCOMING",
    );
    assert.equal(
      deriveEventTemporalStatus({
        startDate: "2026-07-13",
        endDate: "2026-07-14",
        timezone: "UTC",
        now: boundary,
      }),
      "ONGOING",
    );
  });
});
