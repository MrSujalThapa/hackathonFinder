import type {
  DiscoveryMode,
  EventLocation,
  HackathonEvent,
  HackathonEvidence,
  RawLead,
} from "@/core/discovery/types";
import {
  applicationDeadlineFor,
  parseDateEvidenceFromText,
  pickDateEvidence,
} from "@/core/dates";
import {
  isXSocialUrl,
  pickBestOfficialUrlForXLead,
  resolveXSocialUrl,
} from "@/core/xLeadVerify";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asMode(value: unknown): DiscoveryMode | undefined {
  const mode = asString(value);
  if (mode === "online" || mode === "in-person" || mode === "hybrid" || mode === "unknown") {
    return mode;
  }
  return undefined;
}

const THEME_PATTERNS: Array<{ pattern: RegExp; theme: string }> = [
  { pattern: /\bai\b/i, theme: "AI" },
  { pattern: /\bagents?\b/i, theme: "agents" },
  { pattern: /\bcloud\b/i, theme: "cloud" },
  { pattern: /\bweb3\b/i, theme: "web3" },
  { pattern: /\bfintech\b/i, theme: "fintech" },
  { pattern: /\bhealthcare\b/i, theme: "healthcare" },
  { pattern: /\bcybersecurity\b/i, theme: "cybersecurity" },
  { pattern: /\bdeveloper tools\b/i, theme: "developer tools" },
];

const LOCATION_PATTERNS: Array<{ pattern: RegExp; city?: string; country?: string }> = [
  { pattern: /\btoronto\b/i, city: "Toronto", country: "Canada" },
  { pattern: /\bwaterloo\b/i, city: "Waterloo", country: "Canada" },
  { pattern: /\bmississauga\b/i, city: "Mississauga", country: "Canada" },
  { pattern: /\bcanada\b/i, country: "Canada" },
  { pattern: /\bsan francisco\b/i, city: "San Francisco", country: "USA" },
  { pattern: /\bnew york\b/i, city: "New York", country: "USA" },
  { pattern: /\bberkeley\b/i, city: "Berkeley", country: "USA" },
];

function detectModeFromText(text: string): DiscoveryMode | undefined {
  const lower = text.toLowerCase();
  const hasOnline = /\b(online|remote|virtual|worldwide)\b/.test(lower);
  const hasInPerson = /\b(in[- ]?person|on[- ]?site|in person)\b/.test(lower);
  const hasHybrid = /\b(hybrid|both)\b/.test(lower);

  if (hasHybrid || (hasOnline && hasInPerson)) return "hybrid";
  if (hasOnline) return "online";
  if (hasInPerson) return "in-person";
  return undefined;
}

function modeToEventLocationMode(mode: DiscoveryMode | undefined): EventLocation["mode"] {
  if (mode === "online") return "remote";
  if (mode === "in-person") return "in_person";
  if (mode === "hybrid") return "hybrid";
  return "unknown";
}

function detectThemesFromText(text: string): string[] {
  const themes = new Set<string>();
  for (const { pattern, theme } of THEME_PATTERNS) {
    if (pattern.test(text)) themes.add(theme);
  }
  return [...themes];
}

function detectLocationFromText(text: string): {
  city?: string;
  region?: string;
  country?: string;
  location?: string;
  eventLocation?: EventLocation;
} {
  for (const entry of LOCATION_PATTERNS) {
    if (entry.pattern.test(text)) {
      const region = entry.country === "Canada" && entry.city ? "Ontario" : undefined;
      return {
        city: entry.city,
        region,
        country: entry.country,
        location: [entry.city, entry.country].filter(Boolean).join(", ") || undefined,
        eventLocation: {
          mode: "in_person",
          city: entry.city,
          region,
          country: entry.country,
          rawText: text.slice(0, 250),
          confidence: entry.city ? "high" : "medium",
        },
      };
    }
  }

  if (/\b(online|remote|virtual|worldwide)\b/i.test(text)) {
    return {
      city: "Remote",
      country: "Online",
      location: "Online",
      eventLocation: {
        mode: "remote",
        rawText: "Online",
        confidence: "high",
      },
    };
  }

  return {};
}

const SECRET_KEY = /bearer|authorization|api[_-]?key|access[_-]?token|secret|password|credential/i;

/** Strip secrets from evidence raw dumps (bearer tokens, API keys, etc.). */
export function sanitizeEvidenceRaw(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (SECRET_KEY.test(key)) continue;
    if (typeof value === "string") {
      out[key] = /bearer\s+[a-z0-9._~+/=-]+/i.test(value)
        ? "[redacted]"
        : value;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = sanitizeEvidenceRaw(value as Record<string, unknown>);
      continue;
    }
    out[key] = value;
  }
  return out;
}

function buildEvidence(lead: RawLead, event: Partial<HackathonEvent>): HackathonEvidence[] {
  const evidence: HackathonEvidence[] = [];
  const metadata = lead.metadata ?? {};

  if (event.officialUrl) {
    evidence.push({
      type: "official_page",
      url: event.officialUrl,
      title: lead.title,
      snippet: lead.text,
      raw: sanitizeEvidenceRaw({ leadId: lead.id, source: lead.source }),
    });
  }

  if (event.applyUrl) {
    evidence.push({
      type: "apply_page",
      url: event.applyUrl,
      title: `${lead.title ?? event.name} apply`,
      raw: sanitizeEvidenceRaw({ leadId: lead.id, source: lead.source }),
    });
  }

  if (event.socialUrl) {
    evidence.push({
      type: "x_post",
      url: event.socialUrl,
      title: lead.title,
      snippet: lead.text,
      raw: sanitizeEvidenceRaw({ leadId: lead.id, source: lead.source }),
    });
  }

  if (evidence.length === 0 && lead.url) {
    const evidenceType =
      lead.source === "web" || asString(metadata.evidenceType) === "search_result"
        ? "search_result"
        : "source_card";
    evidence.push({
      type: evidenceType,
      url: lead.url,
      title: lead.title,
      snippet: asString(metadata.snippet) ?? lead.text,
      raw: sanitizeEvidenceRaw({
        leadId: lead.id,
        metadata: lead.metadata ?? {},
        source: lead.source,
        query: metadata.query,
      }),
    });
  }

  return evidence;
}

function isSocialUrl(url?: string): boolean {
  return isXSocialUrl(url);
}

export function extractHackathonEvent(
  lead: RawLead,
  options: { now?: Date } = {},
): HackathonEvent | null {
  const metadata = lead.metadata ?? {};
  const combinedText = [lead.title, lead.text, JSON.stringify(metadata)].filter(Boolean).join(" ");
  const sourceUrl = lead.url ?? asString(metadata.officialUrl) ?? "";
  const parsedDateEvidence = parseDateEvidenceFromText(combinedText, {
    now: options.now ?? new Date(),
    sourceUrl,
  });
  const parsedLocation = detectLocationFromText(combinedText);

  const name = asString(metadata.name) ?? lead.title?.trim();
  if (!name) {
    return null;
  }

  const officialFromMetadata = asString(metadata.officialUrl);
  const officialFromLinks = lead.links.find(
    (link) => /official|event|hack|devpost|dorahacks/i.test(link) && !isSocialUrl(link),
  );

  // X: never treat the post URL as official; prefer outbound / enriched page.
  let officialUrl: string | undefined;
  if (lead.source === "x") {
    if (officialFromMetadata && !isSocialUrl(officialFromMetadata)) {
      officialUrl = officialFromMetadata;
    } else {
      officialUrl = pickBestOfficialUrlForXLead(lead);
    }
  } else {
    officialUrl =
      (officialFromMetadata && !isSocialUrl(officialFromMetadata)
        ? officialFromMetadata
        : undefined) ??
      officialFromLinks ??
      (lead.url && !isSocialUrl(lead.url) ? lead.url : undefined);
  }

  const applyUrl =
    asString(metadata.applyUrl) ??
    lead.links.find((link) => /apply|register/i.test(link) && !isSocialUrl(link));

  const socialUrl =
    lead.source === "x"
      ? resolveXSocialUrl(lead)
      : asString(metadata.socialUrl) ??
        (isSocialUrl(lead.url) ? lead.url : undefined) ??
        lead.links.find((link) => isSocialUrl(link));

  const metadataThemes = Array.isArray(metadata.themes)
    ? metadata.themes.filter((value): value is string => typeof value === "string")
    : [];
  const textThemes = detectThemesFromText(combinedText);
  const themes = [...new Set([...metadataThemes, ...textThemes])];

  const mode =
    asMode(metadata.mode) ??
    detectModeFromText(combinedText) ??
    (parsedLocation.city === "Remote" ? "online" : undefined);
  const eventLocation: EventLocation | undefined = {
    ...(parsedLocation.eventLocation ?? {
      mode: modeToEventLocationMode(mode),
      confidence: mode ? "medium" : "low",
    }),
    mode: modeToEventLocationMode(mode) === "unknown"
      ? parsedLocation.eventLocation?.mode ?? "unknown"
      : modeToEventLocationMode(mode),
    city: asString(metadata.city) ?? parsedLocation.city,
    region: asString(metadata.region) ?? parsedLocation.region,
    country: asString(metadata.country) ?? parsedLocation.country,
    rawText: asString(metadata.location) ?? parsedLocation.location ?? parsedLocation.eventLocation?.rawText,
  };

  const eventStartDate =
    asString(metadata.eventStartDate) ??
    asString(metadata.startDate) ??
    pickDateEvidence(parsedDateEvidence, "event_start");
  const eventEndDate =
    asString(metadata.eventEndDate) ??
    asString(metadata.endDate) ??
    pickDateEvidence(parsedDateEvidence, "event_end") ??
    eventStartDate;
  const registrationOpenDate =
    asString(metadata.registrationOpenDate) ??
    pickDateEvidence(parsedDateEvidence, "registration_open");
  const registrationDeadline =
    asString(metadata.registrationDeadline) ??
    asString(metadata.deadline) ??
    pickDateEvidence(parsedDateEvidence, "registration_deadline");
  const applicationDeadline =
    asString(metadata.applicationDeadline) ??
    pickDateEvidence(parsedDateEvidence, "application_deadline");
  const submissionDeadline =
    asString(metadata.submissionDeadline) ??
    pickDateEvidence(parsedDateEvidence, "submission_deadline");
  const resultAnnouncementDate =
    asString(metadata.resultAnnouncementDate) ??
    pickDateEvidence(parsedDateEvidence, "result_announcement");

  const deadline = applicationDeadlineFor({
    registrationDeadline,
    applicationDeadline,
    deadline: undefined,
  });

  const event: HackathonEvent = {
    name,
    source: lead.source,
    officialUrl,
    applyUrl,
    socialUrl,
    eventStartDate,
    eventEndDate,
    registrationOpenDate,
    registrationDeadline,
    applicationDeadline,
    submissionDeadline,
    resultAnnouncementDate,
    parsedDateEvidence,
    startDate: eventStartDate,
    endDate: eventEndDate,
    deadline,
    location:
      asString(metadata.location) ??
      parsedLocation.location ??
      asString(metadata.city),
    mode,
    eventLocation,
    city: asString(metadata.city) ?? parsedLocation.city,
    region: asString(metadata.region) ?? parsedLocation.region,
    country: asString(metadata.country) ?? parsedLocation.country,
    prize: asString(metadata.prize),
    themes,
    eligibility: asString(metadata.eligibility),
    description: lead.text,
    sourceIds:
      metadata.sourceIds && typeof metadata.sourceIds === "object"
        ? (metadata.sourceIds as Record<string, unknown>)
        : { [lead.source]: lead.id },
    evidence: [],
  };

  event.evidence = buildEvidence(lead, event);
  return event;
}

export function extractHackathonEvents(
  leads: RawLead[],
  options: { now?: Date } = {},
): HackathonEvent[] {
  const events: HackathonEvent[] = [];

  for (const lead of leads) {
    try {
      const event = extractHackathonEvent(lead, options);
      if (event) {
        events.push(event);
      }
    } catch {
      // Skip malformed leads without failing the run.
    }
  }

  return events;
}
