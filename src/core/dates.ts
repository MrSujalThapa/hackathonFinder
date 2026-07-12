import type { HackathonEvent } from "@/core/discovery/types";
import { normalizeDatePart } from "@/core/dedupe";

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

export function isEventEnded(event: Pick<HackathonEvent, "endDate" | "startDate">, now: Date = new Date()): boolean {
  const end = normalizeDatePart(event.endDate) ?? normalizeDatePart(event.startDate);
  if (!end || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
  return end < todayIso(now);
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
