import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AcceptedCandidate, HackathonEvent } from "@/core/discovery/types";
import {
  classifyAcceptedLifecycle,
  classifyRejectedLifecycle,
  tallyLifecycles,
} from "@/core/lifecycle";

const NOW = new Date("2026-09-18T12:00:00Z");

function baseEvent(overrides: Partial<HackathonEvent>): HackathonEvent {
  return {
    name: "Test Hackathon",
    source: "mock",
    themes: [],
    evidence: [],
    ...overrides,
  };
}

function accepted(
  event: HackathonEvent,
  status: AcceptedCandidate["status"] = "NEW",
): Pick<AcceptedCandidate, "event" | "status"> {
  return { event, status };
}

describe("classifyAcceptedLifecycle", () => {
  it("is ACTIONABLE when the application is confirmed open and the event is upcoming", () => {
    const event = baseEvent({
      eventStartDate: "2026-11-14",
      eventEndDate: "2026-11-16",
      applicationDeadline: "2026-10-20",
    });
    assert.equal(classifyAcceptedLifecycle(accepted(event), NOW), "ACTIONABLE");
  });

  it("is ACTIONABLE when a source explicitly exposes a future event date, currently-open registration, and a future application deadline", () => {
    const event = baseEvent({
      eventStartDate: "2026-11-14",
      eventEndDate: "2026-11-16",
      registrationOpenDate: "2026-09-01", // registration already opened (in the past relative to NOW)
      registrationDeadline: "2026-10-20", // application deadline still in the future
    });
    assert.equal(classifyAcceptedLifecycle(accepted(event), NOW), "ACTIONABLE");
  });

  it("is LIKELY_ACTIONABLE when the application deadline is unknown but the event is upcoming", () => {
    const event = baseEvent({
      eventStartDate: "2026-12-05",
      eventEndDate: "2026-12-05",
    });
    assert.equal(classifyAcceptedLifecycle(accepted(event), NOW), "LIKELY_ACTIONABLE");
  });

  it("is LIKELY_ACTIONABLE when the event date itself is unknown", () => {
    const event = baseEvent({ applicationDeadline: "2026-10-01" });
    assert.equal(classifyAcceptedLifecycle(accepted(event), NOW), "LIKELY_ACTIONABLE");
  });

  it("is LIKELY_ACTIONABLE (not demoted) when registration has not opened yet", () => {
    const event = baseEvent({
      eventStartDate: "2026-12-05",
      eventEndDate: "2026-12-05",
      registrationOpenDate: "2026-10-01",
      registrationDeadline: "2026-11-01",
    });
    assert.equal(classifyAcceptedLifecycle(accepted(event), NOW), "LIKELY_ACTIONABLE");
  });

  it("defers to NEEDS_REVIEW status regardless of otherwise-actionable dates", () => {
    const event = baseEvent({
      eventStartDate: "2026-11-14",
      eventEndDate: "2026-11-16",
      applicationDeadline: "2026-10-20",
    });
    assert.equal(classifyAcceptedLifecycle(accepted(event, "NEEDS_REVIEW"), NOW), "NEEDS_REVIEW");
  });
});

describe("classifyRejectedLifecycle", () => {
  it("tags a verified-ended event as STALE, not a generic REJECTED", () => {
    assert.equal(
      classifyRejectedLifecycle({ reason: "Event already ended" }),
      "STALE",
    );
  });

  it("tags a verified-passed application deadline as STALE", () => {
    assert.equal(
      classifyRejectedLifecycle({ reason: "Registration/application deadline has passed" }),
      "STALE",
    );
  });

  it("tags a location mismatch as REJECTED, not STALE", () => {
    assert.equal(
      classifyRejectedLifecycle({ reason: "Location mismatch: Tokyo is not Toronto" }),
      "REJECTED",
    );
  });

  it("tags a duplicate/type mismatch as REJECTED", () => {
    assert.equal(classifyRejectedLifecycle({ reason: "Duplicate of an existing candidate" }), "REJECTED");
    assert.equal(
      classifyRejectedLifecycle({ reason: "Candidate is not a hackathon or hackathon-like competition" }),
      "REJECTED",
    );
  });
});

describe("tallyLifecycles", () => {
  it("buckets a mixed batch without collapsing incomplete metadata into rejection", () => {
    const actionable = accepted(
      baseEvent({ eventStartDate: "2026-11-14", eventEndDate: "2026-11-16", applicationDeadline: "2026-10-20" }),
    );
    const likelyActionable = accepted(baseEvent({ eventStartDate: "2026-12-05", eventEndDate: "2026-12-05" }));
    const needsReview = accepted(baseEvent({ eventStartDate: "2026-12-05" }), "NEEDS_REVIEW");
    const stale = { reason: "Event already ended" };
    const rejected = { reason: "Location mismatch: Tokyo is not Toronto" };

    const tally = tallyLifecycles(
      [actionable, likelyActionable, needsReview],
      [stale, rejected],
      NOW,
    );

    assert.deepEqual(tally, {
      ACTIONABLE: 1,
      LIKELY_ACTIONABLE: 1,
      NEEDS_REVIEW: 1,
      STALE: 1,
      REJECTED: 1,
    });
  });
});
