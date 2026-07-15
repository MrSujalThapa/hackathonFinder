import type { HackathonEvent, ParsedDateEvidence } from "@/core/discovery/types";
import { normalizeDatePart } from "@/core/dedupe";

export type EventTemporalStatus = "UPCOMING" | "ONGOING" | "FINISHED" | "UNKNOWN";

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function toUtcDay(value: string | undefined): string | null {
  return normalizeDatePart(value) ?? null;
}

/** Registration/application deadline strictly before today (UTC) => closed. Today remains open. */
export function isDeadlineClosed(deadline: string | undefined, now: Date = new Date()): boolean {
  const day = normalizeDatePart(deadline);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return day < todayIso(now);
}

export function applicationDeadlineFor(event: Pick<HackathonEvent, "registrationDeadline" | "applicationDeadline" | "deadline">): string | undefined {
  return event.registrationDeadline ?? event.applicationDeadline ?? event.deadline;
}

export function eventStartFor(event: Pick<HackathonEvent, "eventStartDate" | "startDate">): string | undefined {
  return event.eventStartDate ?? event.startDate;
}

export function eventEndFor(event: Pick<HackathonEvent, "eventEndDate" | "endDate" | "eventStartDate" | "startDate">): string | undefined {
  return event.eventEndDate ?? event.endDate ?? event.eventStartDate ?? event.startDate;
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
  const start = normalizeDatePart(input.startDate ?? undefined);
  const end = normalizeDatePart(input.endDate ?? input.startDate ?? undefined);

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

export function isEventEnded(event: Pick<HackathonEvent, "endDate" | "startDate" | "eventEndDate" | "eventStartDate">, now: Date = new Date()): boolean {
  return deriveEventTemporalStatus({
    startDate: eventStartFor(event),
    endDate: eventEndFor(event),
    now,
  }) === "FINISHED";
}

/**
 * Title year older than current UTC year without a verified current-edition date.
 */
export function isStaleTitleYear(
  name: string,
  event: Pick<
    HackathonEvent,
    | "startDate"
    | "endDate"
    | "deadline"
    | "eventStartDate"
    | "eventEndDate"
    | "registrationDeadline"
    | "applicationDeadline"
  >,
  now: Date = new Date(),
): boolean {
  const titleYears = [...name.matchAll(/\b(20\d{2})\b/g)].map((m) => Number.parseInt(m[1]!, 10));
  if (titleYears.length === 0) return false;

  const currentYear = now.getUTCFullYear();
  const oldestTitleYear = Math.min(...titleYears);
  if (oldestTitleYear >= currentYear) return false;

  const verifiedYears = [
    event.eventStartDate,
    event.eventEndDate,
    event.startDate,
    event.endDate,
    event.registrationDeadline,
    event.applicationDeadline,
    event.deadline,
  ]
    .map((value) => normalizeDatePart(value))
    .filter((value): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value)))
    .map((value) => Number.parseInt(value.slice(0, 4), 10));

  if (verifiedYears.some((year) => year >= currentYear)) {
    return false;
  }

  return true;
}

const LABELLED_DATE_PATTERNS: Array<{
  kind: ParsedDateEvidence["kind"];
  confidence: ParsedDateEvidence["confidence"];
  pattern: RegExp;
}> = [
  {
    kind: "event_start",
    confidence: "high",
    pattern:
      /\b(?:event date|starts?|begins?|hackathon dates?|competition period|hacking period|opening ceremony|final event|event starts?)\s*[:\-]?\s*((?:20\d{2}-\d{2}-\d{2})|(?:[A-Za-z]+\s+\d{1,2},?\s+20\d{2}))/i,
  },
  {
    kind: "registration_open",
    confidence: "high",
    pattern:
      /\b(?:registration opens?|applications open|apply opens?)\s*[:\-]?\s*((?:20\d{2}-\d{2}-\d{2})|(?:[A-Za-z]+\s+\d{1,2},?\s+20\d{2}))/i,
  },
  {
    kind: "registration_deadline",
    confidence: "high",
    pattern:
      /\b(?:registration deadline|registration closes?|register by|rsvp deadline|last day to register)\s*[:\-]?\s*((?:20\d{2}-\d{2}-\d{2})|(?:[A-Za-z]+\s+\d{1,2},?\s+20\d{2})|(?:\d+\s+days?\s+left))/i,
  },
  {
    kind: "application_deadline",
    confidence: "high",
    pattern:
      /\b(?:application deadline|apply by|applications close)\s*[:\-]?\s*((?:20\d{2}-\d{2}-\d{2})|(?:[A-Za-z]+\s+\d{1,2},?\s+20\d{2})|(?:\d+\s+days?\s+left))/i,
  },
  {
    kind: "submission_deadline",
    confidence: "high",
    pattern:
      /\b(?:submission deadline|submissions close|project submission|build deadline|final submission)\s*[:\-]?\s*((?:20\d{2}-\d{2}-\d{2})|(?:[A-Za-z]+\s+\d{1,2},?\s+20\d{2})|(?:\d+\s+days?\s+left))/i,
  },
  {
    kind: "submission_open",
    confidence: "high",
    pattern:
      /\b(?:submissions? open|submissions? begin|submission period begins?|project submission opens?)\s*[:\-]?\s*((?:20\d{2}-\d{2}-\d{2})|(?:[A-Za-z]+\s+\d{1,2},?\s+20\d{2}))/i,
  },
  {
    kind: "judging_start",
    confidence: "high",
    pattern:
      /\b(?:judging begins?|judging starts?|review period begins?)\s*[:\-]?\s*((?:20\d{2}-\d{2}-\d{2})|(?:[A-Za-z]+\s+\d{1,2},?\s+20\d{2}))/i,
  },
  {
    kind: "judging_end",
    confidence: "high",
    pattern:
      /\b(?:judging ends?|judging closes?|review period ends?)\s*[:\-]?\s*((?:20\d{2}-\d{2}-\d{2})|(?:[A-Za-z]+\s+\d{1,2},?\s+20\d{2}))/i,
  },
  {
    kind: "result_announcement",
    confidence: "medium",
    pattern:
      /\b(?:results? announced|winners? announced|result announcement)\s*[:\-]?\s*((?:20\d{2}-\d{2}-\d{2})|(?:[A-Za-z]+\s+\d{1,2},?\s+20\d{2}))/i,
  },
];

function normalizeDateEvidenceValue(raw: string, now: Date): string | null {
  if (/days?\s+left/i.test(raw)) {
    const days = Number.parseInt(raw, 10);
    if (Number.isNaN(days)) return null;
    const date = new Date(now.getTime());
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }
  return normalizeDatePart(raw);
}

function pushEvidence(
  evidence: ParsedDateEvidence[],
  item: ParsedDateEvidence,
): void {
  const key = `${item.kind}:${item.value ?? ""}:${item.sourceText ?? ""}`;
  if (evidence.some((existing) => `${existing.kind}:${existing.value ?? ""}:${existing.sourceText ?? ""}` === key)) {
    return;
  }
  evidence.push(item);
}

export function parseDateEvidenceFromText(
  text: string,
  options: { now?: Date; sourceUrl?: string } = {},
): ParsedDateEvidence[] {
  const now = options.now ?? new Date();
  const sourceUrl = options.sourceUrl ?? "";
  const evidence: ParsedDateEvidence[] = [];

  for (const { kind, confidence, pattern } of LABELLED_DATE_PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.source, "gi"))) {
      const raw = match[1]?.trim();
      if (!raw) continue;
      pushEvidence(evidence, {
        kind,
        confidence,
        sourceUrl,
        sourceText: match[0]?.slice(0, 180),
        value: normalizeDateEvidenceValue(raw, now),
      });
    }
  }

  const range = text.match(
    /\b(?:event date|hackathon dates?|competition period|hacking period)\s*[:\-]?\s*([A-Za-z]+\s+\d{1,2})(?:\s*(?:-|to|through|until)\s*(?:([A-Za-z]+)\s+)?(\d{1,2})),?\s*(20\d{2})\b/i,
  );
  if (range) {
    const start = normalizeDatePart(`${range[1]}, ${range[4]}`);
    const endMonth = range[2] ?? range[1]!.split(/\s+/)[0];
    const end = normalizeDatePart(`${endMonth} ${range[3]}, ${range[4]}`);
    pushEvidence(evidence, {
      kind: "event_start",
      confidence: "high",
      sourceUrl,
      sourceText: range[0],
      value: start,
    });
    pushEvidence(evidence, {
      kind: "event_end",
      confidence: "high",
      sourceUrl,
      sourceText: range[0],
      value: end,
    });
  }

  const daysLeft = text.match(/\b(\d+)\s+days?\s+left\b/i);
  if (daysLeft?.[0] && /\b(apply|registration|register|applications?)\b/i.test(text)) {
    pushEvidence(evidence, {
      kind: "registration_deadline",
      confidence: "medium",
      sourceUrl,
      sourceText: daysLeft[0],
      value: normalizeDateEvidenceValue(daysLeft[0], now),
    });
  }

  return evidence;
}

export function pickDateEvidence(
  evidence: ParsedDateEvidence[] | undefined,
  kind: ParsedDateEvidence["kind"],
): string | undefined {
  return evidence?.find((item) => item.kind === kind && item.value)?.value ?? undefined;
}

export function parseDatesFromText(
  text: string,
  now: Date = new Date(),
): {
  startDate?: string;
  endDate?: string;
  deadline?: string;
} {
  const evidence = parseDateEvidenceFromText(text, { now });
  const startDate = pickDateEvidence(evidence, "event_start");
  const endDate = pickDateEvidence(evidence, "event_end") ?? startDate;
  const deadline =
    pickDateEvidence(evidence, "registration_deadline") ??
    pickDateEvidence(evidence, "application_deadline");
  return {
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    ...(deadline ? { deadline } : {}),
  };
}
