import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveEventTemporalStatus,
  parseDateEvidenceFromText,
  parseDatesFromText,
} from "@/core/dates";

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

  it("treats a missing end date as a one-day event", () => {
    assert.equal(
      deriveEventTemporalStatus({
        startDate: "2026-07-11",
        timezone: "America/Toronto",
        now,
      }),
      "FINISHED",
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

describe("parseDateEvidenceFromText", () => {
  const now = new Date("2026-07-15T12:00:00Z");

  it("keeps event dates separate from application and submission deadlines", () => {
    const evidence = parseDateEvidenceFromText(
      [
        "Event date: September 12, 2026",
        "Applications close: August 1, 2026",
        "Submission deadline: September 14, 2026",
        "Results announced: September 30, 2026",
      ].join(" "),
      { now },
    );

    assert.equal(
      evidence.find((item) => item.kind === "event_start")?.value,
      "2026-09-12",
    );
    assert.equal(
      evidence.find((item) => item.kind === "application_deadline")?.value,
      "2026-08-01",
    );
    assert.equal(
      evidence.find((item) => item.kind === "submission_deadline")?.value,
      "2026-09-14",
    );
    assert.equal(
      evidence.find((item) => item.kind === "result_announcement")?.value,
      "2026-09-30",
    );
  });

  it("does not turn an unlabelled positional date into an application deadline", () => {
    assert.deepEqual(parseDatesFromText("Join us on August 3, 2026", now), {});
  });

  it("maps relative days-left text only when registration context exists", () => {
    assert.equal(
      parseDatesFromText("Registration closes in 5 days left", now).deadline,
      "2026-07-20",
    );
    assert.equal(parseDatesFromText("5 days left", now).deadline, undefined);
  });

  it("parses labelled date ranges into event start and end dates", () => {
    assert.deepEqual(
      parseDatesFromText("Hackathon dates: September 12-14, 2026", now),
      {
        startDate: "2026-09-12",
        endDate: "2026-09-14",
      },
    );
  });
});
