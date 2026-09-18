import type { AcceptedCandidate, RejectedCandidate } from "@/core/discovery/types";
import {
  applicationStatusFor,
  deriveEventTemporalStatus,
  eventEndFor,
  eventStartFor,
  timezoneForLocation,
} from "@/core/dates";

/**
 * Reporting-level classification layered on top of the existing NEW /
 * NEEDS_REVIEW candidate statuses and REJECTED persistence status — it does
 * not replace them or require a schema change. STALE vs REJECTED both persist
 * as REJECTED; STALE narrows to the date-based reasons so audits can tell
 * "verified past" apart from "wrong type/duplicate/location".
 */
export type OpportunityLifecycle =
  | "ACTIONABLE"
  | "LIKELY_ACTIONABLE"
  | "NEEDS_REVIEW"
  | "STALE"
  | "REJECTED";

const STALE_REASON_RE =
  /deadline has passed|registration closed|event already ended|deadline\b.*passed/i;

/**
 * ACTIONABLE requires a confirmed-open application and an upcoming/ongoing
 * event. Everything else that survived hard eligibility (i.e. was not a
 * verified past event or verified closed application) is LIKELY_ACTIONABLE —
 * unresolved application status/deadline must never demote a candidate to
 * NEEDS_REVIEW or REJECTED on its own.
 */
export function classifyAcceptedLifecycle(
  candidate: Pick<AcceptedCandidate, "event" | "status">,
  now: Date = new Date(),
): OpportunityLifecycle {
  if (candidate.status === "NEEDS_REVIEW") return "NEEDS_REVIEW";

  const applicationStatus = applicationStatusFor(candidate.event, now);
  const temporalStatus = deriveEventTemporalStatus({
    startDate: eventStartFor(candidate.event),
    endDate: eventEndFor(candidate.event),
    timezone: timezoneForLocation(candidate.event),
    now,
  });

  if (
    applicationStatus === "open" &&
    (temporalStatus === "UPCOMING" || temporalStatus === "ONGOING")
  ) {
    return "ACTIONABLE";
  }

  // Hard eligibility already rejects verified-finished events and verified
  // -closed applications before a candidate reaches "accepted", so any other
  // combination here (unresolved application status, unknown event date,
  // not-yet-open application) is a plausible near-term opportunity.
  return "LIKELY_ACTIONABLE";
}

export function classifyRejectedLifecycle(
  candidate: Pick<RejectedCandidate, "reason">,
): OpportunityLifecycle {
  return STALE_REASON_RE.test(candidate.reason) ? "STALE" : "REJECTED";
}

export type LifecycleTally = Record<OpportunityLifecycle, number>;

export function emptyLifecycleTally(): LifecycleTally {
  return {
    ACTIONABLE: 0,
    LIKELY_ACTIONABLE: 0,
    NEEDS_REVIEW: 0,
    STALE: 0,
    REJECTED: 0,
  };
}

export function tallyLifecycles(
  accepted: Array<Pick<AcceptedCandidate, "event" | "status">>,
  rejected: Array<Pick<RejectedCandidate, "reason">>,
  now: Date = new Date(),
): LifecycleTally {
  const tally = emptyLifecycleTally();
  for (const candidate of accepted) {
    tally[classifyAcceptedLifecycle(candidate, now)] += 1;
  }
  for (const candidate of rejected) {
    tally[classifyRejectedLifecycle(candidate)] += 1;
  }
  return tally;
}
