/**
 * Devpost native hackathon collector.
 *
 * Why Playwright: `GET https://devpost.com/hackathons` returns a marketing shell
 * without challenge tiles. Public listing cards (`a.tile-anchor`) are client-rendered.
 * Playwright is used only for that public listing page — never for account login.
 */
import * as cheerio from "cheerio";
import type {
  DiscoveryPreferences,
  DiscoveryProfile,
  ParsedDateEvidence,
  RawLead,
} from "@/core/discovery/types";
import { normalizeDatePart } from "@/core/dedupe";
import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";
import { fetchHtml } from "@/lib/http/fetchHtml";
import {
  formatPlaywrightInstallHint,
  isPlaywrightBrowserMissingError,
  withPlaywright,
} from "@/lib/browser/playwright";
import { collectUntilStable } from "@/crawl";
import { collectDevpostViaKernel } from "@/crawl/adapters/devpost";
import { normalizeUrl, normalizeUrlForDedupe, slugify, uniqueUrls } from "@/lib/http/url";

const DEVPOST_BASE = "https://devpost.com";
const DEVPOST_MAX_EVENTS = 100;
const DEVPOST_MAX_SCROLLS_PER_PAGE = 6;
const DEVPOST_SCROLL_NO_GROWTH_LIMIT = 2;
const DEVPOST_SCROLL_WAIT_MS = 800;
const DEVPOST_PAGE_TIMEOUT_MS = 12_000;
const DEVPOST_DETAIL_TIMEOUT_MS = 7_000;
const DEVPOST_DETAIL_CONCURRENCY = 3;

export type DevpostProfileBudget = {
  /** Hard safety ceiling — never treat as source exhaustion. */
  maxCards: number;
  maxPages: number;
  detailLimit: number;
  /** Product target for this profile (light/standard stop here; deep is a minimum). */
  targetCards: number;
  /** When true, stop with `target_reached` once `targetCards` unique cards are collected. */
  stopAtTarget: boolean;
};

/**
 * Product acquisition targets (full-directory scope, filter afterward):
 * - light: 50–100 unique, stop at target, few detail pages
 * - standard: ~150–250 unique, continue while new cards appear up to target
 * - deep: ≥300 unique minimum; continue beyond while yielding and budget remains
 * - exhaustive: substantially beyond deep until genuine exhaustion / hard bounds
 */
export function devpostBudgetForProfile(
  profile: DiscoveryProfile | undefined,
  requestedMaxResults: number,
): DevpostProfileBudget {
  const requested = Math.max(1, requestedMaxResults);
  switch (profile) {
    case "exhaustive":
      return {
        maxCards: Math.max(requested, 2_500),
        maxPages: 320,
        detailLimit: 160,
        targetCards: 1_000,
        stopAtTarget: false,
      };
    case "deep":
      // 300 is a minimum target, not an exhaustion claim — budget allows continuing past it.
      return {
        maxCards: Math.max(requested, 500),
        maxPages: 90,
        detailLimit: 80,
        targetCards: 300,
        stopAtTarget: false,
      };
    case "standard":
      return {
        maxCards: Math.min(Math.max(requested, 200), 250),
        maxPages: 40,
        detailLimit: 24,
        targetCards: Math.min(Math.max(requested, 150), 200),
        stopAtTarget: true,
      };
    case "light":
    default:
      return {
        maxCards: Math.min(Math.max(requested, 75), 100),
        maxPages: 14,
        detailLimit: 8,
        targetCards: Math.min(Math.max(requested, 50), 75),
        stopAtTarget: true,
      };
  }
}

/** How Devpost listing acquisition was scoped — never confuse subset with full directory. */
export type DevpostAcquisitionScope =
  | "full_directory_api"
  | "open_upcoming_api_subset"
  | "full_rendered_directory";

export function buildDevpostListingsUrl(page: number): string {
  const pageNumber = Math.max(1, Math.floor(page));
  return `${DEVPOST_BASE}/hackathons?status[]=upcoming&status[]=open&page=${pageNumber}`;
}
export const DEVPOST_OPEN_UPCOMING_URL = buildDevpostListingsUrl(1);
/** Unfiltered public directory HTML (browser-visible surface). */
export const DEVPOST_FULL_DIRECTORY_URL = `${DEVPOST_BASE}/hackathons`;

/**
 * Structured listing endpoint observed while scrolling https://devpost.com/hackathons:
 * GET /api/hackathons?page=N (no status filter) with meta.total_count spanning the full directory.
 */
export function buildDevpostFullDirectoryApiUrl(page: number): string {
  const pageNumber = Math.max(1, Math.floor(page));
  return `${DEVPOST_BASE}/api/hackathons?page=${pageNumber}`;
}

/** Subset query only — label telemetry as open_upcoming_api_subset, never full inventory. */
export function buildDevpostOpenUpcomingApiUrl(page: number): string {
  const pageNumber = Math.max(1, Math.floor(page));
  return `${DEVPOST_BASE}/api/hackathons?status[]=upcoming&status[]=open&page=${pageNumber}`;
}

export function buildDevpostApiUrl(
  page: number,
  scope: DevpostAcquisitionScope = "full_directory_api",
): string {
  if (scope === "open_upcoming_api_subset") return buildDevpostOpenUpcomingApiUrl(page);
  return buildDevpostFullDirectoryApiUrl(page);
}

export function parseDevpostApiRequestScope(url: string): DevpostAcquisitionScope {
  try {
    const parsed = new URL(url);
    const statuses = parsed.searchParams.getAll("status[]");
    if (statuses.length === 0) return "full_directory_api";
    const normalized = new Set(statuses.map((value) => value.toLowerCase()));
    if (
      normalized.size === 2 &&
      normalized.has("open") &&
      normalized.has("upcoming")
    ) {
      return "open_upcoming_api_subset";
    }
    return "full_directory_api";
  } catch {
    return "full_directory_api";
  }
}

export function classifyDevpostOpenState(
  status: string | undefined,
): "open" | "upcoming" | "ended" | "unknown" {
  const raw = (status ?? "").trim().toLowerCase();
  if (raw === "open") return "open";
  if (raw === "upcoming") return "upcoming";
  if (raw === "ended" || raw === "closed" || raw === "archive") return "ended";
  if (!raw) return "unknown";
  if (isEndedStatus(status, "")) return "ended";
  return "unknown";
}

export function buildDevpostDatesUrl(url: string): string | undefined {
  const canonical = canonicalizeDevpostUrl(url);
  if (!canonical || !isDevpostHackathonUrl(canonical)) return undefined;
  try {
    const parsed = new URL(canonical);
    parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/details/dates`;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export type DevpostFailureHint =
  | "network"
  | "anti_bot"
  | "rate_limit"
  | "browser_missing"
  | "page_load"
  | "redirected"
  | "listing_container_missing"
  | "selector_parser_failure"
  | "lazy_loading_timeout"
  | "zero_matching_results"
  | "no_current_events";

export type DevpostLazyLoadStopReason =
  | "end_marker_reached"
  | "no_additional_cards"
  | "maximum_scrolls_reached"
  | "maximum_cards_reached"
  | "target_reached"
  | "timeout"
  | "parser_failure";

type ParsedDevpostCard = {
  title: string;
  url: string;
  description?: string;
  prize?: string;
  dateText?: string;
  location?: string;
  status?: string;
  organizer?: string;
  links: string[];
};

type DevpostApiHackathon = {
  id?: number | string;
  title?: string;
  url?: string;
  displayed_location?: { location?: string; icon?: string };
  open_state?: string;
  time_left_to_submission?: string;
  submission_period_dates?: string;
  themes?: Array<{ name?: string }>;
  prize_amount?: string;
  organization_name?: string;
  winners_announced?: boolean;
  start_a_submission_url?: string;
};

type DevpostApiPayload = {
  hackathons?: DevpostApiHackathon[];
  meta?: {
    total_count?: number;
    per_page?: number;
  };
};

export type DevpostApiPageResult = {
  requestedPage: number;
  requestedUrl: string;
  finalUrl: string;
  activePage: number;
  leads: RawLead[];
  cardCount: number;
  fingerprint: string;
  firstUrls: string[];
  lastUrls: string[];
  hasNext: boolean;
  nextPage?: number;
  status: "completed" | "degraded" | "failed";
  stopReason?: string;
  error?: string;
  metaTotalCount?: number;
};

export function describeDevpostFailure(hint: DevpostFailureHint, detail?: string): string {
  switch (hint) {
    case "network":
      return `Devpost network failure${detail ? `: ${detail}` : ""}`;
    case "anti_bot":
      return `Devpost blocked or anti-bot response${detail ? `: ${detail}` : ""}`;
    case "rate_limit":
      return `Devpost rate limit${detail ? `: ${detail}` : ""}`;
    case "browser_missing":
      return detail ?? formatPlaywrightInstallHint();
    case "page_load":
      return `Devpost page failed to load${detail ? `: ${detail}` : ""}`;
    case "redirected":
      return `Devpost filtered URL redirected unexpectedly${detail ? `: ${detail}` : ""}`;
    case "listing_container_missing":
      return `Devpost listing container missing${detail ? `: ${detail}` : ""}`;
    case "selector_parser_failure":
      return `Devpost selector/parser failure: UI may have changed${detail ? ` (${detail})` : ""}`;
    case "lazy_loading_timeout":
      return `Devpost lazy-loading timeout${detail ? `: ${detail}` : ""}`;
    case "no_current_events":
      return "Devpost returned no current/upcoming hackathons.";
    case "zero_matching_results":
      return "Devpost returned no matching hackathon cards.";
  }
}

/** Canonical challenge URL without tracking query params. */
export function canonicalizeDevpostUrl(url: string): string | undefined {
  const normalized = normalizeUrl(url, DEVPOST_BASE);
  if (!normalized) return undefined;
  try {
    const parsed = new URL(normalized);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "") + "/";
  } catch {
    return normalized;
  }
}

export function isRejectedDevpostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (
      host === "info.devpost.com" ||
      host === "help.devpost.com" ||
      host === "secure.devpost.com" ||
      host === "support.devpost.com" ||
      host === "api.devpost.com"
    ) {
      return true;
    }

    if (host === "devpost.com" || host === "www.devpost.com") {
      if (
        path === "/" ||
        path === "/hackathons" ||
        path.startsWith("/hackathons/") ||
        path.startsWith("/software") ||
        path.startsWith("/portfolio") ||
        path.startsWith("/settings") ||
        path.startsWith("/users") ||
        path.startsWith("/follows") ||
        path.startsWith("/notifications") ||
        path.startsWith("/challenges/search")
      ) {
        return true;
      }
      // Bare user profile pages: /username
      if (/^\/[^/]+\/?$/.test(path) && !path.includes(".")) {
        return true;
      }
    }

    return false;
  } catch {
    return true;
  }
}

export function isDevpostHackathonUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith("devpost.com")) return false;
    if (isRejectedDevpostUrl(url)) return false;

    // Challenge subdomain pages like ai-agent-summit.devpost.com
    if (host !== "devpost.com" && host !== "www.devpost.com") {
      return true;
    }

    // Rare path-style challenge pages under www
    return /^\/[^/]+\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isEndedStatus(status: string | undefined, text: string): boolean {
  const blob = `${status ?? ""} ${text}`.toLowerCase();
  return /\b(ended|closed|archived|winners\s+announced)\b/.test(blob) &&
    !/\b(upcoming|open|live)\b/.test(blob);
}

/**
 * Source-specific public listing queries: Canada, Toronto, remote, AI, upcoming.
 */
export function buildDevpostSearchUrls(preferences: DiscoveryPreferences): string[] {
  void preferences;
  return [DEVPOST_OPEN_UPCOMING_URL];
}

function parseDevpostDateValue(raw: string | undefined, fallbackYear = new Date().getUTCFullYear()): string | undefined {
  if (!raw) return undefined;
  const compact = raw
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?(?:\s+[A-Z]{2,4})?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!/\b20\d{2}\b/.test(compact) && /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i.test(compact)) {
    return normalizeDatePart(`${compact}, ${fallbackYear}`) ?? undefined;
  }
  return normalizeDatePart(compact) ?? undefined;
}

export type DevpostDateRange = {
  displayedDateRange: string;
  startDate?: string;
  endDate?: string;
};

export function parseDevpostDisplayedDateRange(
  value: string | undefined,
  now: Date = new Date(),
): DevpostDateRange | undefined {
  const displayedDateRange = value?.replace(/\s+/g, " ").trim();
  if (!displayedDateRange) return undefined;
  const text = displayedDateRange.replace(/[–—]/g, "-");
  const yearMatch = text.match(/\b(20\d{2})\b/g);
  const fallbackYear = yearMatch
    ? Number.parseInt(yearMatch[yearMatch.length - 1]!, 10)
    : now.getUTCFullYear();
  const match = text.match(
    /\b([A-Za-z]{3,9})\s+(\d{1,2})(?:,?\s*(20\d{2}))?\s*(?:-|to|through|until)\s*(?:([A-Za-z]{3,9})\s+)?(\d{1,2})(?:,?\s*(20\d{2}))?\b/i,
  );
  if (!match) return { displayedDateRange };
  const startYear = Number.parseInt(match[3] ?? String(fallbackYear), 10);
  const endYear = Number.parseInt(match[6] ?? match[3] ?? String(fallbackYear), 10);
  const startMonth = match[1]!;
  const endMonth = match[4] ?? startMonth;
  return {
    displayedDateRange,
    startDate: parseDevpostDateValue(`${startMonth} ${match[2]}, ${startYear}`, fallbackYear),
    endDate: parseDevpostDateValue(`${endMonth} ${match[5]}, ${endYear}`, fallbackYear),
  };
}

function devpostDateEvidence(input: {
  kind: ParsedDateEvidence["kind"];
  value?: string;
  confidence?: ParsedDateEvidence["confidence"];
  sourceUrl: string;
  sourceText?: string;
  sourceType?: ParsedDateEvidence["sourceType"];
}): ParsedDateEvidence | undefined {
  if (!input.value) return undefined;
  return {
    kind: input.kind,
    value: input.value,
    confidence: input.confidence ?? "high",
    sourceUrl: input.sourceUrl,
    sourceText: input.sourceText,
    sourceType: input.sourceType,
    retrievedAt: new Date().toISOString(),
  };
}

function displayedRangeMetadata(
  dateText: string | undefined,
  sourceUrl: string,
  sourceType: ParsedDateEvidence["sourceType"],
  semanticRole: "submission_period" | "uncertain",
): Record<string, unknown> {
  const range = parseDevpostDisplayedDateRange(dateText);
  if (!range) return {};
  const evidence = [
    semanticRole === "submission_period"
      ? devpostDateEvidence({
          kind: "submission_open",
          value: range.startDate,
          sourceUrl,
          sourceText: range.displayedDateRange,
          sourceType,
        })
      : undefined,
    semanticRole === "submission_period"
      ? devpostDateEvidence({
          kind: "submission_deadline",
          value: range.endDate,
          sourceUrl,
          sourceText: range.displayedDateRange,
          sourceType,
        })
      : undefined,
  ].filter((item): item is ParsedDateEvidence => Boolean(item));
  return {
    displayedDateRange: range.displayedDateRange,
    ...(semanticRole === "submission_period"
      ? {
          submissionOpenDate: range.startDate,
          submissionDeadline: range.endDate,
        }
      : {}),
    parsedDateEvidence: evidence.length > 0 ? evidence : undefined,
    dateExtractionState: semanticRole === "submission_period" ? "submission_period_from_listing" : "displayed_range_only",
  };
}

export type DevpostScheduleDates = {
  eventStartDate?: string;
  eventEndDate?: string;
  registrationOpenDate?: string;
  registrationDeadline?: string;
  submissionOpenDate?: string;
  submissionDeadline?: string;
  judgingStartDate?: string;
  judgingEndDate?: string;
  resultAnnouncementDate?: string;
  parsedDateEvidence: ParsedDateEvidence[];
};

const DEVPOST_SCHEDULE_LABELS: Array<{
  key: keyof DevpostScheduleDates;
  evidenceKind: ParsedDateEvidence["kind"];
  label: RegExp;
  endpoint: "begin" | "end" | "single";
}> = [
  { key: "eventStartDate", evidenceKind: "event_start", label: /\b(?:hackathon|event|challenge|competition)\b/i, endpoint: "begin" },
  { key: "eventEndDate", evidenceKind: "event_end", label: /\b(?:hackathon|event|challenge|competition)\b/i, endpoint: "end" },
  { key: "registrationOpenDate", evidenceKind: "registration_open", label: /\b(?:registration|applications?)\b/i, endpoint: "begin" },
  { key: "registrationDeadline", evidenceKind: "registration_deadline", label: /\b(?:registration|applications?)\b/i, endpoint: "end" },
  { key: "submissionOpenDate", evidenceKind: "submission_open", label: /\bsubmissions?\b/i, endpoint: "begin" },
  { key: "submissionDeadline", evidenceKind: "submission_deadline", label: /\bsubmissions?\b/i, endpoint: "end" },
  { key: "judgingStartDate", evidenceKind: "judging_start", label: /\bjudging\b/i, endpoint: "begin" },
  { key: "judgingEndDate", evidenceKind: "judging_end", label: /\bjudging\b/i, endpoint: "end" },
  { key: "resultAnnouncementDate", evidenceKind: "result_announcement", label: /\b(?:winners?|results?)\b/i, endpoint: "single" },
];

function scheduleDateRegex(endpoint: "begin" | "end" | "single"): RegExp {
  const date = "([A-Za-z]{3,9}\\s+\\d{1,2}(?:,?\\s+20\\d{2})?)(?:\\s+at\\s+\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?(?:\\s+[A-Z]{2,4})?)?";
  if (endpoint === "begin") return new RegExp(`\\b(?:begins?|starts?|opens?)\\s*:?\\s*${date}`, "i");
  if (endpoint === "end") return new RegExp(`\\b(?:ends?|closes?|deadline)\\s*:?\\s*${date}`, "i");
  return new RegExp(`\\b(?:announced?|posted|winners?|results?)\\s*:?\\s*${date}`, "i");
}

function orderedScheduleDates(segment: string, fallbackYear: number): string[] {
  const dates = [
    ...segment.matchAll(
      /\b[A-Za-z]{3,9}\s+\d{1,2}(?:,?\s+20\d{2})?(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?(?:\s+[A-Z]{2,4})?)?/gi,
    ),
  ]
    .map((match) => parseDevpostDateValue(match[0], fallbackYear))
    .filter((value): value is string => Boolean(value));
  return [...new Set(dates)];
}

function scheduleSegments($: cheerio.CheerioAPI): string[] {
  const segments = $("section, article, li, tr, .challenge-timeline-item, .timeline-item, .phase")
    .map((_index, node) =>
      $(node)
        .text()
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .get()
    .filter((text) => text.length > 8);
  if (segments.length > 0) return segments;
  return [$.root().text().replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim()];
}

export function parseDevpostScheduleHtml(
  html: string,
  sourceUrl: string,
  now: Date = new Date(),
): DevpostScheduleDates {
  const $ = cheerio.load(html);
  const result: DevpostScheduleDates = { parsedDateEvidence: [] };
  const fallbackYear = now.getUTCFullYear();
  const segments = scheduleSegments($);

  for (const segment of segments) {
    const segmentDates = orderedScheduleDates(segment, fallbackYear);
    for (const item of DEVPOST_SCHEDULE_LABELS) {
      if (result[item.key] || !item.label.test(segment)) continue;
      const match = segment.match(scheduleDateRegex(item.endpoint));
      const value =
        parseDevpostDateValue(match?.[1], fallbackYear) ??
        (item.endpoint === "end" ? segmentDates[1] : segmentDates[0]);
      if (!value) continue;
      (result[item.key] as string | undefined) = value;
      const evidence = devpostDateEvidence({
        kind: item.evidenceKind,
        value,
        sourceUrl,
        sourceText: segment.slice(0, 220),
        sourceType: "schedule",
      });
      if (evidence) result.parsedDateEvidence.push(evidence);
    }
  }

  return result;
}

function extractTileFields(
  anchor: ReturnType<cheerio.CheerioAPI>,
  $: cheerio.CheerioAPI,
): Omit<ParsedDevpostCard, "url" | "links" | "title"> & { title: string } {
  const title =
    anchor.find("h2, h3, .title, .challenge-title").first().text().trim() ||
    anchor.attr("title")?.trim() ||
    "";

  const status = anchor.find(".status-label, .hackathon-status").first().text().trim() || undefined;
  const prize =
    anchor.find(".prize-amount, .prize, .prizes").first().text().replace(/\s+/g, " ").trim() ||
    undefined;
  const location =
    anchor.find(".info span, .location, .challenge-location").first().text().trim() ||
    undefined;

  const dateCandidates = anchor
    .find("div, span, time")
    .map((_i, node) => $(node).text().replace(/\s+/g, " ").trim())
    .get()
    .filter((text) =>
      /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i.test(text) &&
      /\d{4}|\d{1,2}/.test(text) &&
      text.length < 40,
    );
  const dateText = dateCandidates[0];

  const description =
    anchor.find(".description, p").first().text().replace(/\s+/g, " ").trim() || undefined;

  // Organizer often sits just before the date range in the tile text.
  const organizer =
    anchor
      .find(".host, .organizer, .company-name")
      .first()
      .text()
      .trim() || undefined;

  return { title, status, prize, location, dateText, description, organizer };
}

export function parseDevpostHtml(html: string, maxResults: number): RawLead[] {
  const $ = cheerio.load(html);
  const cards: ParsedDevpostCard[] = [];

  const selectors = [
    "a.tile-anchor",
    "a.flex-row.tile-anchor",
    "a.block-wrapper-link",
    "a.challenge-listing",
  ];

  const seenAnchors = new Set<unknown>();

  for (const selector of selectors) {
    $(selector).each((_index, element) => {
      if (seenAnchors.has(element)) return;
      seenAnchors.add(element);

      const anchor = $(element);
      const hrefRaw = normalizeUrl(anchor.attr("href") ?? "", DEVPOST_BASE);
      const href = hrefRaw ? canonicalizeDevpostUrl(hrefRaw) : undefined;
      if (!href || !isDevpostHackathonUrl(href)) return;

      const fields = extractTileFields(anchor, $);
      if (!fields.title || fields.title.length < 3) return;
      if (/^(log in|sign up|help desk|settings|about)$/i.test(fields.title)) return;

      const blob = anchor.text();
      if (isEndedStatus(fields.status, blob)) return;

      cards.push({
        ...fields,
        url: href,
        links: uniqueUrls([href], DEVPOST_BASE),
      });
    });
  }

  // Fallback: subdomain challenge links without tile class (older markup / partial render)
  if (cards.length === 0) {
    $("a[href*='.devpost.com']").each((_index, element) => {
      const anchor = $(element);
      const hrefRaw = normalizeUrl(anchor.attr("href") ?? "", DEVPOST_BASE);
      const href = hrefRaw ? canonicalizeDevpostUrl(hrefRaw) : undefined;
      if (!href || !isDevpostHackathonUrl(href)) return;

      const fields = extractTileFields(anchor, $);
      const title =
        fields.title ||
        href
          .replace(/^https?:\/\//i, "")
          .replace(/\.devpost\.com\/.*/i, "")
          .replace(/-/g, " ");
      if (!title || title.length < 4) return;
      if (isEndedStatus(fields.status, anchor.text())) return;

      cards.push({
        ...fields,
        title,
        url: href,
        links: uniqueUrls([href], DEVPOST_BASE),
      });
    });
  }

  const leads: RawLead[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    const key = normalizeUrlForDedupe(card.url);
    if (seen.has(key)) continue;
    seen.add(key);

    const mode = /online|remote|virtual|worldwide/i.test(
      `${card.location ?? ""} ${card.description ?? ""}`,
    )
      ? "online"
      : /hybrid/i.test(`${card.location ?? ""} ${card.description ?? ""}`)
        ? "hybrid"
        : undefined;

    leads.push({
      id: `devpost-${slugify(card.title)}`,
      source: "devpost",
      title: card.title,
      url: card.url,
      text: [card.description, card.prize, card.dateText, card.location, card.status]
        .filter(Boolean)
        .join(" — "),
      links: card.links,
      postedAt: new Date().toISOString(),
      metadata: {
        prize: card.prize,
        dateText: card.dateText,
        ...displayedRangeMetadata(card.dateText, card.url, "listing", "uncertain"),
        location: card.location,
        status: card.status,
        organizer: card.organizer,
        mode,
        officialUrl: card.url,
        applyUrl: card.url,
        attribution: "devpost",
        provenance: "native_devpost",
        discoveryMode: "native_devpost",
        sourceAuthority: "devpost",
        sourceIds: { devpost: slugify(card.title) },
      },
    });

    if (leads.length >= maxResults) break;
  }

  return leads;
}

function cleanDevpostText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return cheerio.load(value).text().replace(/\s+/g, " ").trim() || undefined;
}

export function devpostFingerprint(urls: string[]): string {
  return [...new Set(urls.map((url) => canonicalizeDevpostUrl(url)).filter(Boolean) as string[])]
    .sort()
    .join("|");
}

export function parseDevpostApiPayload(
  payload: DevpostApiPayload,
  maxResults: number,
  options: { includeEnded?: boolean } = {},
): RawLead[] {
  const includeEnded = options.includeEnded !== false;
  const leads: RawLead[] = [];
  for (const item of payload.hackathons ?? []) {
    if (leads.length >= maxResults) break;
    const url = item.url ? canonicalizeDevpostUrl(item.url) : undefined;
    if (!url || !isDevpostHackathonUrl(url) || isRejectedDevpostUrl(url)) continue;
    const title = item.title?.trim();
    if (!title) continue;
    const status = item.open_state?.trim();
    const dateText = item.submission_period_dates?.trim();
    const location = item.displayed_location?.location?.trim();
    const prize = cleanDevpostText(item.prize_amount);
    const themes = (item.themes ?? [])
      .map((theme) => theme.name?.trim())
      .filter((theme): theme is string => Boolean(theme));
    const text = [
      item.time_left_to_submission,
      dateText,
      location,
      prize,
      item.organization_name,
      themes.join(", "),
    ]
      .filter(Boolean)
      .join(" - ");
    const openStateClass = classifyDevpostOpenState(status);
    // Collection gathers directory cards first; pipeline filters closed events later.
    if (!includeEnded && openStateClass === "ended") continue;

    leads.push({
      id: `devpost-${item.id ?? slugify(title)}`,
      source: "devpost",
      title,
      url,
      text,
      links: uniqueUrls([url, item.start_a_submission_url].filter(Boolean) as string[], DEVPOST_BASE),
      postedAt: new Date().toISOString(),
      metadata: {
        prize,
        dateText,
        ...displayedRangeMetadata(dateText, url, "api", "submission_period"),
        location,
        status,
        openState: openStateClass,
        organizer: item.organization_name,
        themes,
        mode:
          location && /online|virtual|remote/i.test(location)
            ? "online"
            : location
              ? "in-person"
              : "unknown",
        officialUrl: url,
        applyUrl: item.start_a_submission_url ?? url,
        attribution: "devpost",
        provenance: "native_devpost",
        discoveryMode: "native_devpost",
        acquisitionScope: "full_directory_api",
        sourceAuthority: "devpost",
        sourceIds: { devpost: item.id ?? slugify(title) },
      },
    });
  }
  return leads;
}

export async function fetchDevpostApiPage(
  pageNumber: number,
  maxResults: number,
  timeoutMs: number,
  scope: DevpostAcquisitionScope = "full_directory_api",
): Promise<DevpostApiPageResult> {
  const requestedUrl = buildDevpostApiUrl(pageNumber, scope);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(requestedUrl, {
      signal: controller.signal,
      headers: { accept: "application/json, text/plain, */*" },
    });
    const finalUrl = response.url || requestedUrl;
    if (!response.ok) {
      return {
        requestedPage: pageNumber,
        requestedUrl,
        finalUrl,
        activePage: pageNumber,
        leads: [],
        cardCount: 0,
        fingerprint: "",
        firstUrls: [],
        lastUrls: [],
        hasNext: false,
        status: "failed",
        stopReason: `http_${response.status}`,
        error: describeDevpostFailure("page_load", `HTTP ${response.status}`),
      };
    }
    const payload = (await response.json()) as DevpostApiPayload;
    const leads = parseDevpostApiPayload(payload, maxResults, { includeEnded: true }).map(
      (lead) => ({
        ...lead,
        metadata: {
          ...lead.metadata,
          acquisitionScope: parseDevpostApiRequestScope(finalUrl),
        },
      }),
    );
    const urls = leads.map((lead) => lead.url).filter(Boolean) as string[];
    const perPage = payload.meta?.per_page ?? (payload.hackathons ?? []).length;
    const totalCount = payload.meta?.total_count ?? undefined;
    const hasNext =
      typeof totalCount === "number"
        ? pageNumber * Math.max(perPage, 1) < totalCount
        : (payload.hackathons ?? []).length > 0;
    return {
      requestedPage: pageNumber,
      requestedUrl,
      finalUrl,
      activePage: pageNumber,
      leads,
      cardCount: (payload.hackathons ?? []).length,
      fingerprint: devpostFingerprint(urls),
      firstUrls: urls.slice(0, 3),
      lastUrls: urls.slice(-3),
      hasNext,
      nextPage: hasNext ? pageNumber + 1 : undefined,
      status: "completed",
      stopReason: hasNext ? undefined : "no_next_page",
      metaTotalCount: totalCount,
    };
  } catch (error) {
    return {
      requestedPage: pageNumber,
      requestedUrl,
      finalUrl: requestedUrl,
      activePage: pageNumber,
      leads: [],
      cardCount: 0,
      fingerprint: "",
      firstUrls: [],
      lastUrls: [],
      hasNext: false,
      status: "failed",
      stopReason: "api_error",
      error:
        error instanceof Error
          ? describeDevpostFailure("network", error.message)
          : describeDevpostFailure("network"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export type DevpostRenderedListing = {
  html: string;
  warnings: string[];
  initialCardCount: number;
  finalCardCount: number;
  scrollAttempts: number;
  noGrowthAttempts: number;
  stopReason: DevpostLazyLoadStopReason;
  finalUrl: string;
  listingContainerFound: boolean;
  emptyStateFound: boolean;
};

async function collectRenderedDevpostListing(
  url: string,
  pageNumber: number,
  timeoutMs: number,
  logger?: (message: string) => void,
): Promise<DevpostRenderedListing> {
  const warnings: string[] = [];
  const startedAt = Date.now();

  return withPlaywright(async ({ page }) => {
    logger?.(`Opening Devpost directory page ${pageNumber}...`);
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    if (!response || response.status() >= 400) {
      throw new Error(
        describeDevpostFailure("page_load", `HTTP ${response?.status() ?? "unknown"}`),
      );
    }

    const finalUrl = page.url();
    let redirected = !finalUrl.includes("/hackathons");
    try {
      const requested = new URL(url, DEVPOST_BASE);
      const parsed = new URL(finalUrl);
      const requestedStatuses = requested.searchParams.getAll("status[]");
      const statuses = parsed.searchParams.getAll("status[]");
      // Only enforce open+upcoming filter parity when the request itself was filtered.
      if (requestedStatuses.length > 0) {
        redirected =
          redirected ||
          !statuses.includes("upcoming") ||
          !statuses.includes("open") ||
          parsed.searchParams.get("page") !== String(pageNumber);
      } else {
        redirected = redirected || !parsed.pathname.includes("/hackathons");
      }
    } catch {
      redirected = true;
    }
    if (redirected) {
      warnings.push(describeDevpostFailure("redirected", finalUrl));
    }

    await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, DEVPOST_PAGE_TIMEOUT_MS) }).catch(() => {
      warnings.push(describeDevpostFailure("lazy_loading_timeout", "network idle not reached"));
    });

    const listingContainerFound =
      (await page.locator(".hackathons, [class*='hackathon'], a.tile-anchor").count().catch(() => 0)) > 0;
    const emptyStateFound =
      (await page
        .locator("text=/no hackathons|no results|nothing found/i")
        .count()
        .catch(() => 0)) > 0;

    if (!listingContainerFound && !emptyStateFound) {
      warnings.push(describeDevpostFailure("listing_container_missing"));
    }

    await page
      .locator("a.tile-anchor")
      .first()
      .waitFor({ state: "attached", timeout: Math.min(timeoutMs, 12_000) })
      .catch(() => undefined);

    const uniqueCardCount = async () =>
      page.locator("a.tile-anchor").evaluateAll((anchors) => {
        const urls = anchors
          .map((anchor) => (anchor as HTMLAnchorElement).href)
          .filter(Boolean);
        return new Set(urls).size;
      });

    const initialCardCount = await uniqueCardCount().catch(() => 0);
    logger?.(`Page ${pageNumber}: initial listing batch loaded`);
    logger?.(`Page ${pageNumber}: ${initialCardCount} event cards found`);

    const collected = await collectUntilStable<string>({
      collectItems: async () =>
        page.locator("a.tile-anchor").evaluateAll((anchors) =>
          anchors.map((anchor) => (anchor as HTMLAnchorElement).href).filter(Boolean),
        ),
      getKey: (url) => normalizeUrlForDedupe(url),
      scroll: async () => {
        await page.mouse.wheel(0, 2600).catch(() => undefined);
      },
      waitForIdle: async () => {
        await page.waitForLoadState("networkidle", { timeout: DEVPOST_SCROLL_WAIT_MS }).catch(() => undefined);
      },
      maxItems: DEVPOST_MAX_EVENTS,
      maxScrolls: DEVPOST_MAX_SCROLLS_PER_PAGE,
      noGrowthLimit: DEVPOST_SCROLL_NO_GROWTH_LIMIT,
      timeoutMs: Math.max(1_000, timeoutMs - (Date.now() - startedAt)),
      waitMs: DEVPOST_SCROLL_WAIT_MS,
      logger,
      loadingMessage: `Page ${pageNumber}: loading more listings...`,
      countMessage: (count) => `Page ${pageNumber}: ${count} event cards found`,
    });

    let stopReason: DevpostLazyLoadStopReason =
      collected.stopReason === "max_items"
        ? "maximum_cards_reached"
        : collected.stopReason === "max_scrolls"
          ? "maximum_scrolls_reached"
          : collected.stopReason === "timeout"
            ? "timeout"
            : "no_additional_cards";
    const endMarker =
      (await page
        .locator("text=/end of results|no more hackathons|no additional/i")
        .count()
        .catch(() => 0)) > 0;
    if (endMarker) stopReason = "end_marker_reached";
    if (stopReason === "timeout") {
      warnings.push(describeDevpostFailure("lazy_loading_timeout"));
    }
    if (stopReason === "no_additional_cards") {
      logger?.(`Page ${pageNumber}: no more cards found after ${collected.noGrowthAttempts} attempts`);
    }

    logger?.(`Page ${pageNumber}: lazy loading complete`);

    return {
      html: await page.content(),
      warnings,
      initialCardCount,
      finalCardCount: collected.uniqueCount,
      scrollAttempts: collected.scrollAttempts,
      noGrowthAttempts: collected.noGrowthAttempts,
      stopReason,
      finalUrl: page.url(),
      listingContainerFound,
      emptyStateFound,
    };
  }, { timeoutMs });
}

function hasDevpostChallengePage(html: string): boolean {
  return /captcha|cloudflare|verify you are human|access denied|blocked/i.test(html);
}

function stopEvidenceForDevpost(
  stopReason: string,
  metaTotalCount: number | null,
  targetCards?: number,
): string {
  switch (stopReason) {
    case "no_next_page":
      return metaTotalCount != null
        ? `api_meta_total_count_reached:${metaTotalCount}`
        : "source_reported_no_next_page";
    case "no_additional_cards":
      return "batch_added_zero_unique_identities";
    case "repeated_fingerprint":
      return "identical_page_fingerprint_repeated";
    case "target_reached":
      return `profile_target_reached:${targetCards ?? "unknown"}`;
    case "maximum_cards_reached":
      return "safety_card_budget_reached_not_source_exhaustion";
    case "maximum_pages_reached":
      return "safety_page_budget_reached_not_source_exhaustion";
    case "timeout":
      return "source_timeout_not_source_exhaustion";
    case "api_page_failed":
      return "first_api_page_failed";
    default:
      return stopReason;
  }
}

async function collectDevpostApiPages(
  maxResults: number,
  maxPages: number,
  timeoutMs: number,
  logger?: (message: string) => void,
  scope: DevpostAcquisitionScope = "full_directory_api",
  options?: { targetCards?: number; stopAtTarget?: boolean },
): Promise<{
  leads: RawLead[];
  pages: DevpostApiPageResult[];
  duplicateUrls: number;
  repeatedPages: number;
  stopReason: string;
  stopEvidence: string;
  acquisitionScope: DevpostAcquisitionScope;
  metaTotalCount: number | null;
  statusCounts: Record<string, number>;
  listingDurationMs: number;
  targetReached: boolean;
}> {
  const result = await collectDevpostViaKernel({
    maxResults,
    maxPages,
    timeoutMs,
    scope: scope === "open_upcoming_api_subset" ? "open_upcoming_api_subset" : "full_directory_api",
    targetCards: options?.targetCards,
    stopAtTarget: options?.stopAtTarget,
    fetchPage: async (pageNumber, pageMaxResults, pageTimeoutMs, pageScope) => {
      const page = await fetchDevpostApiPage(
        pageNumber,
        pageMaxResults,
        Math.min(pageTimeoutMs, DEVPOST_PAGE_TIMEOUT_MS),
        pageScope,
      );
      return {
        requestedPage: page.requestedPage,
        requestedUrl: page.requestedUrl,
        finalUrl: page.finalUrl,
        leads: page.leads,
        cardCount: page.cardCount,
        fingerprint: page.fingerprint,
        firstUrls: page.firstUrls,
        lastUrls: page.lastUrls,
        hasNext: page.hasNext,
        nextPage: page.nextPage,
        status: page.status,
        stopReason: page.stopReason,
        error: page.error,
        metaTotalCount: page.metaTotalCount,
      };
    },
    classifyOpenState: classifyDevpostOpenState,
    buildApiUrl: buildDevpostApiUrl,
    stopEvidence: stopEvidenceForDevpost,
    logger,
  });

  return {
    leads: result.leads,
    pages: result.pages.map((page) => ({
      requestedPage: page.requestedPage,
      requestedUrl: page.requestedUrl,
      finalUrl: page.finalUrl,
      activePage: page.requestedPage,
      leads: page.leads,
      cardCount: page.cardCount,
      fingerprint: page.fingerprint,
      firstUrls: page.firstUrls,
      lastUrls: page.lastUrls,
      hasNext: page.hasNext,
      nextPage: page.nextPage,
      status: page.status,
      stopReason: page.stopReason,
      error: page.error,
      metaTotalCount: page.metaTotalCount,
    })),
    duplicateUrls: result.duplicateUrls,
    repeatedPages: result.repeatedPages,
    stopReason: result.stopReason,
    stopEvidence: result.stopEvidence,
    acquisitionScope: result.acquisitionScope,
    metaTotalCount: result.metaTotalCount,
    statusCounts: result.statusCounts,
    listingDurationMs: result.listingDurationMs,
    targetReached: result.targetReached,
  };
}

function shouldFetchDevpostSchedule(lead: RawLead): boolean {
  const metadata = lead.metadata ?? {};
  return Boolean(
    lead.url &&
      isDevpostHackathonUrl(lead.url) &&
      (!metadata.submissionDeadline ||
        !metadata.submissionOpenDate ||
        !metadata.judgingStartDate ||
        !metadata.resultAnnouncementDate),
  );
}

async function enrichDevpostSchedules(
  leads: RawLead[],
  options: {
    limit: number;
    timeoutMs: number;
    startedAt: number;
    logger?: (message: string) => void;
  },
): Promise<{ leads: RawLead[]; opened: number; failures: number; warnings: string[] }> {
  const warnings: string[] = [];
  const targetIds = new Set(
    leads
      .filter(shouldFetchDevpostSchedule)
      .slice(0, options.limit)
      .map((lead) => lead.id),
  );
  let opened = 0;
  let failures = 0;
  let next = 0;
  const enriched = [...leads];

  async function worker(): Promise<void> {
    while (next < enriched.length) {
      const index = next;
      next += 1;
      const lead = enriched[index]!;
      if (!targetIds.has(lead.id) || !lead.url) continue;
      if (Date.now() - options.startedAt > options.timeoutMs) break;
      const datesUrl = buildDevpostDatesUrl(lead.url);
      if (!datesUrl) continue;
      const remaining = Math.min(
        DEVPOST_DETAIL_TIMEOUT_MS,
        Math.max(1_500, options.timeoutMs - (Date.now() - options.startedAt)),
      );
      try {
        opened += 1;
        options.logger?.(`Opening Devpost dates page ${opened}/${targetIds.size}: ${datesUrl}`);
        const html = await fetchHtml(datesUrl, {
          timeoutMs: remaining,
          retries: 1,
          headers: { Accept: "text/html,application/xhtml+xml" },
        });
        const schedule = parseDevpostScheduleHtml(html, datesUrl);
        const existingEvidence = Array.isArray(lead.metadata?.parsedDateEvidence)
          ? lead.metadata?.parsedDateEvidence
          : [];
        enriched[index] = {
          ...lead,
          links: uniqueUrls([...lead.links, datesUrl], DEVPOST_BASE),
          metadata: {
            ...lead.metadata,
            ...Object.fromEntries(
              Object.entries(schedule).filter(([key, value]) =>
                key !== "parsedDateEvidence" && typeof value === "string" && value.length > 0,
              ),
            ),
            parsedDateEvidence: [
              ...(existingEvidence as ParsedDateEvidence[]),
              ...schedule.parsedDateEvidence,
            ],
            dateExtractionState:
              schedule.parsedDateEvidence.length > 0
                ? "authoritative_dates_page"
                : lead.metadata?.dateExtractionState,
            datesUrl,
          },
        };
      } catch (error) {
        failures += 1;
        warnings.push(
          error instanceof Error
            ? `Devpost dates enrichment failed for ${datesUrl}: ${error.message}`
            : `Devpost dates enrichment failed for ${datesUrl}`,
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(DEVPOST_DETAIL_CONCURRENCY, targetIds.size) }, () => worker()),
  );
  return { leads: enriched, opened, failures, warnings };
}

export const devpostCollector: Collector = {
  source: "devpost",

  async collect(input: CollectorInput): Promise<CollectorResult> {
    const startedAt = Date.now();
    const result = emptyCollectorResult("devpost", startedAt);
    const searchUrls = buildDevpostSearchUrls(input.preferences);
    const seen = new Set<string>();
    const budget = devpostBudgetForProfile(input.preferences.profile, input.maxResults);
    const maxAccepted = budget.maxCards;
    let pagesFetched = 0;
    let initialCardCount = 0;
    let finalCardCount = 0;
    let detailPagesOpened = 0;
    let detailFailures = 0;
    const scrollAttempts = 0;
    const noGrowthAttempts = 0;
    const pageNoGrowthAttempts = 0;
    let duplicateUrls = 0;
    let parserFailures = 0;
    let stopReason: DevpostLazyLoadStopReason | "maximum_pages_reached" = "no_additional_cards";

    const acquisitionScope: DevpostAcquisitionScope = "full_directory_api";
    result.warnings.push(
      "Devpost listing uses the browser-observed full-directory API GET /api/hackathons?page=N (no status filter). open+upcoming is a subset only.",
    );
    result.warnings.push(`acquisition_scope=${acquisitionScope}`);

    try {
      void searchUrls;
      input.logger?.(
        "Using full-directory Devpost API pagination (same endpoint the live /hackathons page loads while scrolling)...",
      );
      const api = await collectDevpostApiPages(
        maxAccepted,
        budget.maxPages,
        input.timeoutMs,
        input.logger,
        acquisitionScope,
        { targetCards: budget.targetCards, stopAtTarget: budget.stopAtTarget },
      );
      pagesFetched = api.pages.length;
      finalCardCount = api.leads.length;
      initialCardCount = api.pages[0]?.cardCount ?? 0;
      duplicateUrls = api.duplicateUrls;
      parserFailures = api.pages.filter((page) => page.status === "failed").length;
      stopReason = api.stopReason as DevpostLazyLoadStopReason | "maximum_pages_reached";
      for (const page of api.pages) {
        if (page.error) result.warnings.push(page.error);
        result.warnings.push(`page_${page.requestedPage}_requested=${page.requestedUrl}`);
        result.warnings.push(`page_${page.requestedPage}_final=${page.finalUrl}`);
        result.warnings.push(`page_${page.requestedPage}_cards=${page.cardCount}`);
        result.warnings.push(`page_${page.requestedPage}_fingerprint=${page.fingerprint.slice(0, 160)}`);
        if (page.stopReason) {
          result.warnings.push(`page_${page.requestedPage}_stop_reason=${page.stopReason}`);
        }
      }
      result.warnings.push(`stop_evidence=${api.stopEvidence}`);
      result.warnings.push(`meta_total_count=${api.metaTotalCount ?? "unknown"}`);
      result.warnings.push(`directory_reported_total=${api.metaTotalCount ?? "unknown"}`);
      result.warnings.push(`target_for_profile=${budget.targetCards}`);
      result.warnings.push(`target_reached=${api.targetReached ? "true" : "false"}`);
      result.warnings.push(`status_open=${api.statusCounts.open ?? 0}`);
      result.warnings.push(`status_upcoming=${api.statusCounts.upcoming ?? 0}`);
      result.warnings.push(`status_ended=${api.statusCounts.ended ?? 0}`);
      result.warnings.push(`status_unknown=${api.statusCounts.unknown ?? 0}`);
      result.warnings.push(`listing_duration_ms=${api.listingDurationMs}`);

      input.logger?.(
        `Listing acquisition complete (${api.leads.length} unique, stop=${api.stopReason}, target=${budget.targetCards}, targetReached=${api.targetReached}). Starting detail enrichment…`,
      );
      const detailStartedAt = Date.now();
      const enriched = await enrichDevpostSchedules(api.leads, {
        limit: budget.detailLimit,
        timeoutMs: input.timeoutMs,
        startedAt,
        logger: input.logger,
      });
      const detailDurationMs = Date.now() - detailStartedAt;
      result.leads = enriched.leads;
      result.warnings.push(...enriched.warnings);
      detailPagesOpened = enriched.opened;
      detailFailures = enriched.failures;
      result.warnings.push(`detail_duration_ms=${detailDurationMs}`);

      result.metrics = {
        pagesFetched,
        playwrightPages: 0,
        initialCardCount,
        finalCardCount,
        uniqueCards: api.leads.length,
        detailPagesOpened,
        detailFailures,
        maxCards: budget.maxCards,
        maxPages: budget.maxPages,
        detailLimit: budget.detailLimit,
        targetForProfile: budget.targetCards,
        targetReached: api.targetReached ? 1 : 0,
        directoryReportedTotal: api.metaTotalCount ?? 0,
        scrollAttempts,
        noGrowthAttempts,
        pageNoGrowthAttempts,
        duplicateUrls,
        parserFailures,
        repeatedPages: api.repeatedPages,
        leadsEmitted: result.leads.length,
        searchUrls: pagesFetched,
        listingDurationMs: api.listingDurationMs,
        detailDurationMs,
        metaTotalCount: api.metaTotalCount ?? 0,
        statusOpen: api.statusCounts.open ?? 0,
        statusUpcoming: api.statusCounts.upcoming ?? 0,
        statusEnded: api.statusCounts.ended ?? 0,
        statusUnknown: api.statusCounts.unknown ?? 0,
      };
      result.warnings.push(`stop_reason=${stopReason}`);
      result.warnings.push(`profile_budget_cards=${budget.maxCards}`);
      result.warnings.push(`profile_budget_pages=${budget.maxPages}`);
      result.warnings.push(`profile_budget_detail_limit=${budget.detailLimit}`);
      result.warnings.push(`profile_target_cards=${budget.targetCards}`);
      result.warnings.push(`profile_stop_at_target=${budget.stopAtTarget ? "true" : "false"}`);
      result.warnings.push(`details_opened=${detailPagesOpened}`);
      result.warnings.push(`detail_failures=${detailFailures}`);
      result.warnings.push(`unique_cards=${api.leads.length}`);
      result.warnings.push(`scrolls=${scrollAttempts}`);
      result.warnings.push(`no_growth_attempts=${noGrowthAttempts}`);
      result.warnings.push(`page_no_growth_attempts=${pageNoGrowthAttempts}`);
      result.warnings.push(`duplicates=${duplicateUrls}`);

      if (result.leads.length === 0 && result.errors.length === 0) {
        const searchUrl = DEVPOST_FULL_DIRECTORY_URL;
        const remaining = Math.max(1_000, input.timeoutMs - (Date.now() - startedAt));
        const rendered = await collectRenderedDevpostListing(
          searchUrl,
          1,
          Math.min(remaining, DEVPOST_PAGE_TIMEOUT_MS),
          input.logger,
        );
        result.warnings.push(...rendered.warnings);
        finalCardCount = Math.max(finalCardCount, rendered.finalCardCount);
        const fallback = await enrichDevpostSchedules(
          parseDevpostHtml(rendered.html, maxAccepted),
          {
            limit: budget.detailLimit,
            timeoutMs: input.timeoutMs,
            startedAt,
            logger: input.logger,
          },
        );
        result.warnings.push(...fallback.warnings);
        detailPagesOpened += fallback.opened;
        detailFailures += fallback.failures;
        for (const lead of fallback.leads) {
          const key = lead.url ? normalizeUrlForDedupe(lead.url) : lead.id;
          if (seen.has(key)) continue;
          seen.add(key);
          result.leads.push(lead);
        }

        if (rendered.finalCardCount === 0 && hasDevpostChallengePage(rendered.html)) {
          result.errors.push(describeDevpostFailure("anti_bot"));
        }
        if (finalCardCount > 0 || parserFailures > 0) {
          result.warnings.push(
            describeDevpostFailure(
              "selector_parser_failure",
              "Filtered listing page loaded, but no event cards matched the parser. The Devpost page structure may have changed.",
            ),
          );
          input.logger?.(
            "Filtered listing page loaded, but no event cards matched the parser. The Devpost page structure may have changed.",
          );
        } else {
          result.warnings.push(describeDevpostFailure("zero_matching_results"));
        }
      } else if (result.leads.length > 0) {
        input.logger?.(`${result.leads.length} matching leads accepted`);
      }
    } catch (error) {
      if (isPlaywrightBrowserMissingError(error)) {
        result.errors.push(describeDevpostFailure("browser_missing"));
      } else {
        result.errors.push(
          describeDevpostFailure(
            "page_load",
            error instanceof Error ? error.message : "Devpost rendered listing failed",
          ),
        );
      }
    }

    result.status =
      result.errors.length > 0
        ? "failed"
        : result.warnings.some((warning) => /parser failure|parser|timeout|redirected|missing/i.test(warning))
          ? "degraded"
          : "completed";
    result.diagnostics = {
      discovered: finalCardCount,
      returned: result.leads.length,
      enriched: 0,
      partial: parserFailures + detailFailures,
      dropped: Math.max(0, finalCardCount - result.leads.length),
      stopReason,
      safeMessage:
        result.leads.length === 0 && finalCardCount > 0
          ? "Devpost listings rendered, but the event-card parser returned no leads."
          : undefined,
    };
    result.durationMs = Date.now() - startedAt;
    return result;
  },
};
