import type { HackathonEvent, VerificationResult } from "@/core/discovery/types";
import { normalizeDatePart } from "@/core/dedupe";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isValidIsoDate(value?: string): boolean {
  if (!value) return false;
  return Boolean(normalizeDatePart(value));
}

function hasUsefulUrl(event: HackathonEvent): boolean {
  return Boolean(event.officialUrl || event.applyUrl || event.socialUrl);
}

function isSocialOnly(event: HackathonEvent): boolean {
  return Boolean(event.socialUrl && !event.officialUrl && !event.applyUrl);
}

function isClearlyPast(event: HackathonEvent): boolean {
  const dates = [event.endDate, event.deadline, event.startDate]
    .map((value) => normalizeDatePart(value))
    .filter(Boolean) as string[];

  if (dates.length === 0) {
    return false;
  }

  return dates.sort().at(-1)! < todayIso();
}

export function verifyHackathonEvent(event: HackathonEvent): VerificationResult {
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

  if (isClearlyPast(event)) {
    return {
      valid: false,
      confidence: "high",
      status: "rejected",
      reasons: ["Event already ended"],
      redFlags: ["Event already ended"],
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

  if (!isValidIsoDate(event.deadline) && !isValidIsoDate(event.startDate)) {
    redFlags.push("Date or deadline unclear");
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
    event.officialUrl && event.applyUrl && (event.deadline || event.startDate)
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
