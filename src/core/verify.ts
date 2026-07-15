import type { HackathonEvent, VerificationResult } from "@/core/discovery/types";
import { normalizeDatePart } from "@/core/dedupe";
import {
  applicationDeadlineFor,
  deriveEventTemporalStatus,
  eventEndFor,
  eventStartFor,
  isDeadlineClosed,
  isStaleTitleYear,
  todayIso,
  timezoneForLocation,
} from "@/core/dates";

function isValidIsoDate(value?: string): boolean {
  if (!value) return false;
  const part = normalizeDatePart(value);
  return Boolean(part && /^\d{4}-\d{2}-\d{2}$/.test(part));
}

function hasUsefulUrl(event: HackathonEvent): boolean {
  return Boolean(event.officialUrl || event.applyUrl || event.socialUrl);
}

function isSocialOnly(event: HackathonEvent): boolean {
  return Boolean(event.socialUrl && !event.officialUrl && !event.applyUrl);
}

export type VerifyOptions = {
  now?: Date;
};

export function verifyHackathonEvent(
  event: HackathonEvent,
  options: VerifyOptions = {},
): VerificationResult {
  const now = options.now ?? new Date();
  const reasons: string[] = [];
  const redFlags: string[] = [];

  if (!event.name.trim()) {
    return {
      valid: false,
      confidence: "low",
      status: "rejected",
      reasons: ["Missing event name"],
      redFlags: ["Missing event name"],
    };
  }

  if (isDeadlineClosed(applicationDeadlineFor(event), now)) {
    return {
      valid: false,
      confidence: "high",
      status: "rejected",
      reasons: ["Registration deadline has passed"],
      redFlags: ["Registration closed"],
    };
  }

  const temporalStatus = deriveEventTemporalStatus({
    startDate: eventStartFor(event),
    endDate: eventEndFor(event),
    timezone: timezoneForLocation(event),
    now,
  });

  if (temporalStatus === "FINISHED") {
    return {
      valid: false,
      confidence: "high",
      status: "rejected",
      reasons: ["Event already ended"],
      redFlags: ["Event already ended"],
    };
  }
  if (temporalStatus === "UNKNOWN") {
    redFlags.push("Date unclear");
  }

  if (isStaleTitleYear(event.name, event, now)) {
    return {
      valid: false,
      confidence: "high",
      status: "rejected",
      reasons: ["Title year is in the past without a verified current edition"],
      redFlags: ["Stale title year"],
    };
  }

  if (!hasUsefulUrl(event)) {
    return {
      valid: false,
      confidence: "low",
      status: "rejected",
      reasons: ["No official, apply, or social URL"],
      redFlags: ["No useful URL"],
    };
  }

  if (isSocialOnly(event)) {
    return {
      valid: true,
      confidence: "low",
      status: "needs_review",
      reasons: ["Social-only lead without official page"],
      redFlags: ["Needs official link"],
    };
  }

  if (!isValidIsoDate(applicationDeadlineFor(event))) {
    redFlags.push("Applications close: Unknown");
  }
  if (!isValidIsoDate(eventStartFor(event))) {
    redFlags.push("Event date unclear");
  }

  if (event.officialUrl) {
    reasons.push("Official URL present");
  }
  if (event.applyUrl) {
    reasons.push("Apply URL present");
  }
  if (event.city || event.country || event.mode) {
    reasons.push("Location/mode present");
  }

  const confidence =
    event.officialUrl && event.applyUrl && (applicationDeadlineFor(event) || eventStartFor(event))
      ? "high"
      : event.officialUrl || event.applyUrl
        ? "medium"
        : "low";

  return {
    valid: true,
    confidence,
    status: "accepted",
    reasons,
    redFlags,
  };
}

export { todayIso };
