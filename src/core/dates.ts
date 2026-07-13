import type { HackathonEvent } from "@/core/discovery/types";
import { normalizeDatePart } from "@/core/dedupe";

export type EventTemporalStatus = "UPCOMING" | "ONGOING" | "FINISHED" | "UNKNOWN";

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function toUtcDay(value: string | undefined): string | null {
  return normalizeDatePart(value) ?? null;
}

/** Registration deadline strictly before today (UTC) => closed. Today remains open. */
export function isDeadlineClosed(deadline: string | undefined, now: Date = new Date()): boolean {
  const day = normalizeDatePart(deadline);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return day < todayIso(now);
}

function todayInTimeZone(now: Date, timezone = "UTC"): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // Fall through to UTC when the caller supplied an invalid timezone.
  }
  return todayIso(now);
}

export function deriveEventTemporalStatus(input: {
  startDate?: string | null;
  endDate?: string | null;
  timezone?: string | null;
  now?: Date;
}): EventTemporalStatus {
  const now = input.now ?? new Date();
  const today = todayInTimeZone(now, input.timezone ?? "UTC");
  const start = normalizeDatePart(input.startDate);
  const end = normalizeDatePart(input.endDate);

  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return "UNKNOWN";
  }
  if (end < today) return "FINISHED";
  if (start <= today && end >= today) return "ONGOING";
  if (start > today) return "UPCOMING";
  return "UNKNOWN";
}

export function timezoneForLocation(input: {
  location?: string | null;
  city?: string | null;
  country?: string | null;
  mode?: string | null;
}): string {
  const blob = [input.location, input.city, input.country]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/toronto|mississauga|waterloo|ontario|canada|gta|greater toronto/.test(blob)) {
    return "America/Toronto";
  }
  if (/india|chhattisgarh|bilaspur/.test(blob)) {
    return "Asia/Kolkata";
  }
  return "UTC";
}

export function isEventEnded(event: Pick<HackathonEvent, "endDate" | "startDate">, now: Date = new Date()): boolean {
  return deriveEventTemporalStatus({
    startDate: event.startDate,
    endDate: event.endDate,
    now,
  }) === "FINISHED";
}

/**
 * Title year older than current UTC year without a verified current-edition date.
 */
export function isStaleTitleYear(
  name: string,
  event: Pick<HackathonEvent, "startDate" | "endDate" | "deadline">,
  now: Date = new Date(),
): boolean {
  const titleYears = [...name.matchAll(/\b(20\d{2})\b/g)].map((m) => Number.parseInt(m[1]!, 10));
  if (titleYears.length === 0) return false;

  const currentYear = now.getUTCFullYear();
  const oldestTitleYear = Math.min(...titleYears);
  if (oldestTitleYear >= currentYear) return false;

  const verifiedYears = [event.startDate, event.endDate, event.deadline]
    .map((value) => normalizeDatePart(value))
    .filter((value): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value)))
    .map((value) => Number.parseInt(value.slice(0, 4), 10));

  if (verifiedYears.some((year) => year >= currentYear)) {
    return false;
  }

  return true;
}

export function parseDatesFromText(
  text: string,
  now: Date = new Date(),
): {
  startDate?: string;
  endDate?: string;
  deadline?: string;
} {
  const result: { startDate?: string; endDate?: string; deadline?: string } = {};

  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/g);
  if (iso?.length) {
    result.startDate = normalizeDatePart(iso[0]) ?? undefined;
    if (iso.length > 1) {
      result.endDate = normalizeDatePart(iso[1]) ?? undefined;
    }
  }

  const monthRange = text.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:\s*[–—-]\s*(?:([A-Za-z]+)\s+)?(\d{1,2}))?,?\s*(20\d{2})\b/i,
  );
  if (monthRange) {
    const start = `${monthRange[1]} ${monthRange[2]}, ${monthRange[5]}`;
    const endMonth = monthRange[3] ?? monthRange[1];
    const endDay = monthRange[4] ?? monthRange[2];
    const end = `${endMonth} ${endDay}, ${monthRange[5]}`;
    result.startDate = normalizeDatePart(start) ?? result.startDate;
    result.endDate = normalizeDatePart(end) ?? result.endDate;
  }

  const deadlineMatch = text.match(
    /\b(?:deadline|closes|close date|apply by|registration closes|register by|submission deadline)\s*[:\-]?\s*((?:20\d{2}-\d{2}-\d{2})|(?:[A-Za-z]+\s+\d{1,2},?\s+20\d{2})|\d+\s+days?\s+left)/i,
  );
  if (deadlineMatch?.[1]) {
    const raw = deadlineMatch[1].trim();
    if (/days?\s+left/i.test(raw)) {
      const days = Number.parseInt(raw, 10);
      if (!Number.isNaN(days)) {
        const date = new Date(now.getTime());
        date.setUTCDate(date.getUTCDate() + days);
        result.deadline = date.toISOString().slice(0, 10);
      }
    } else {
      result.deadline = normalizeDatePart(raw) ?? result.deadline;
    }
  } else {
    const daysLeft = text.match(/\b(\d+)\s+days?\s+left\b/i);
    if (daysLeft?.[1]) {
      const days = Number.parseInt(daysLeft[1], 10);
      if (!Number.isNaN(days)) {
        const date = new Date(now.getTime());
        date.setUTCDate(date.getUTCDate() + days);
        result.deadline = date.toISOString().slice(0, 10);
      }
    }
  }

  return result;
}
