/**
 * Luma public discovery collector.
 *
 * Public mode (default):
 * - City calendars (`/toronto`, `/waterloo`, …) and discover pages embed events in
 *   `__NEXT_DATA__` (lu.ma redirects to luma.com).
 * - Individual event pages (`kind=event`) are accepted when hackathon-like and upcoming.
 * - Calendar hubs, organizer profiles, and bare search/discover pages are never emitted
 *   as candidate events.
 *
 * Connected / authenticated mode:
 * - Optional only. Not required for ordinary public discovery.
 * - Would reuse the same persistent-browser connector architecture as Hakku, but is
 *   currently stubbed as unavailable (no credential storage, no automated login).
 * - See docs/discovery/LUMA_MODES.md for whether auth materially helps.
 */
import * as cheerio from "cheerio";
import type { Page } from "playwright";
import type { DiscoveryProfile, RawLead } from "@/core/discovery/types";
import { normalizeDatePart } from "@/core/dedupe";
import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";
import { fetchHtml, FetchHtmlError } from "@/lib/http/fetchHtml";
import {
  formatPlaywrightInstallHint,
  isPlaywrightBrowserMissingError,
  withPlaywright,
} from "@/lib/browser/playwright";
import { collectUntilStable } from "@/crawl";
import { normalizeUrl, normalizeUrlForDedupe, slugify, uniqueUrls } from "@/lib/http/url";

const LUMA_BASE = "https://luma.com";
const LUMA_LEGACY_BASE = "https://lu.ma";
const LUMA_MAX_EVENTS = 100;
const LUMA_NO_GROWTH_LIMIT = 3;
const LUMA_SCROLL_WAIT_MS = 800;
const DETAIL_PAGE_CONCURRENCY = 6;
const LUMA_DETAIL_TIMEOUT_MS = 8_000;

export type LumaProfileBudget = {
  maxEvents: number;
  maxScrolls: number;
  detailLimit: number;
  /** Product target: deep ≥100 globally unique; light may be lower. */
  targetEvents: number;
  stopAtTarget: boolean;
};

/**
 * Luma product targets (collect before classify):
 * - light: fast; may collect fewer than 100
 * - deep: at least 100 globally unique public events
 * - exhaustive: continue further while routes keep yielding
 * Do not force 200 in this phase.
 */
export function lumaBudgetForProfile(
  profile: DiscoveryProfile | undefined,
  requestedMaxResults: number,
): LumaProfileBudget {
  const requested = Math.max(1, requestedMaxResults);
  switch (profile) {
    case "exhaustive":
      return {
        maxEvents: Math.max(requested, 1_200),
        maxScrolls: 180,
        detailLimit: 180,
        targetEvents: 200,
        stopAtTarget: false,
      };
    case "deep":
      return {
        maxEvents: Math.max(requested, 400),
        maxScrolls: 100,
        detailLimit: 80,
        targetEvents: 100,
        stopAtTarget: false,
      };
    case "standard":
      return {
        maxEvents: Math.min(Math.max(requested, 120), 200),
        maxScrolls: 50,
        detailLimit: 40,
        targetEvents: 100,
        stopAtTarget: false,
      };
    case "light":
    default:
      return {
        maxEvents: Math.min(Math.max(requested, 40), 80),
        maxScrolls: 20,
        detailLimit: 12,
        targetEvents: 40,
        stopAtTarget: true,
      };
  }
}

const HACKATHON_HINT =
  /\b(hackathon|buildathon|codefest|hack\s*day|hack\s*night|coding\s*competition|builder\s*competition|48[\s-]?hour\s*build|24[\s-]?hour\s*hack)\b/i;

const MEETUP_HINT =
  /\b(meetup|coffee|networking|happy\s*hour|casual\s*hang|fireside|panel\s*discussion|book\s*club|walkie|potluck|drink\s*&\s*draw)\b/i;

export type LumaDiscoveryMode = "public" | "authenticated";
export type LumaDiscoveryFeed =
  | "luma_toronto"
  | "luma_waterloo"
  | "luma_tech"
  | "luma_ai"
  | "luma_hackathon"
  | "luma_ai_hackathon"
  | "luma_artificial_intelligence"
  | "luma_remote"
  | "luma_search";

export type LumaFailureHint =
  | "network"
  | "anti_bot"
  | "rate_limit"
  | "browser_missing"
  | "selector_parser_failure"
  | "zero_matching_results"
  | "no_current_events"
  | "auth_required";

type ParsedLumaEvent = {
  title: string;
  url?: string;
  apiId?: string;
  organizer?: string;
  dateText?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  mode?: string;
  description?: string;
  registration?: string;
  externalLinks: string[];
  pageKind?: "event" | "calendar" | "discover" | "profile" | "unknown";
  discoveryMode?: LumaDiscoveryFeed | "luma_public";
  discoveredFrom?: string[];
  timelineHeading?: string;
  timelineTime?: string;
  timezone?: string;
};

type LumaFeedConfig = {
  mode: LumaDiscoveryFeed;
  label: string;
  url: string;
  type: "location" | "topic";
};

export type LumaFeedResolution = {
  requestedLocation?: string;
  feeds: LumaFeedConfig[];
  fallbackReason?: string;
};

type LumaFeedCollection = {
  feed: LumaFeedConfig;
  urls: string[];
  leads: RawLead[];
  uniqueCount: number;
  scrollAttempts: number;
  noGrowthAttempts: number;
  stopReason: string;
  warnings: string[];
};

export function describeLumaFailure(hint: LumaFailureHint, detail?: string): string {
  switch (hint) {
    case "network":
      return `Luma network failure${detail ? `: ${detail}` : ""}`;
    case "anti_bot":
      return `Luma blocked or anti-bot response${detail ? `: ${detail}` : ""}`;
    case "rate_limit":
      return `Luma rate limit${detail ? `: ${detail}` : ""}`;
    case "browser_missing":
      return detail ?? formatPlaywrightInstallHint();
    case "selector_parser_failure":
      return `Luma selector/parser failure: UI may have changed${detail ? ` (${detail})` : ""}`;
    case "no_current_events":
      return "Luma returned no current/upcoming hackathon events.";
    case "zero_matching_results":
      return "Luma returned no likely hackathon events from targeted public discovery pages.";
    case "auth_required":
      return `Luma authentication required${detail ? `: ${detail}` : ""}`;
  }
}

/** Public by default. Authenticated mode is opt-in via LUMA_MODE=authenticated (stubbed). */
export function resolveLumaDiscoveryMode(
  env: NodeJS.ProcessEnv = process.env,
): LumaDiscoveryMode {
  const raw = env.LUMA_MODE?.trim().toLowerCase();
  if (raw === "authenticated" || raw === "connected") return "authenticated";
  return "public";
}

export function isLikelyHackathon(title: string, description: string): boolean {
  const text = `${title} ${description}`;
  if (HACKATHON_HINT.test(text)) return true;
  if (MEETUP_HINT.test(text) && !HACKATHON_HINT.test(text)) return false;
  return (
    /\b(builders?|agents?|prize|registration\s+open)\b/i.test(text) &&
    /\b(hack|build|code)\b/i.test(text)
  );
}

function parseMode(location: string, description: string, locationType?: string): string | undefined {
  const text = `${location} ${description} ${locationType ?? ""}`.toLowerCase();
  if (/online|remote|virtual|everywhere|location_type.?online/.test(text)) return "online";
  if (locationType === "online" || locationType === "virtual") return "online";
  if (/hybrid/i.test(text) || locationType === "hybrid") return "hybrid";
  if (/in\s*person|on-?site|campus|offline/i.test(text) || locationType === "offline") {
    return "in-person";
  }
  return undefined;
}

function extractIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const iso = value.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return undefined;
}

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

function addUtcDays(date: Date, days: number): Date {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function resolveLumaTimelineHeadingDate(
  heading: string | undefined,
  now: Date = new Date(),
): string | undefined {
  const text = heading?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  if (/^today$/i.test(text)) return dateOnly(now);
  if (/^tomorrow$/i.test(text)) return dateOnly(addUtcDays(now, 1));
  if (/^this weekend$/i.test(text)) {
    const delta = (6 - now.getUTCDay() + 7) % 7;
    return dateOnly(addUtcDays(now, delta || 7));
  }

  const weekday = text.match(/^(sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)$/i);
  if (weekday) {
    const target = WEEKDAY_INDEX[weekday[1]!.toLowerCase()];
    if (target == null) return undefined;
    const delta = (target - now.getUTCDay() + 7) % 7;
    return dateOnly(addUtcDays(now, delta));
  }

  const absolute = text.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:,?\s*(20\d{2}))?\b/);
  if (absolute) {
    const year = absolute[3] ?? String(now.getUTCFullYear());
    let normalized = normalizeDatePart(`${absolute[1]} ${absolute[2]}, ${year}`) ?? undefined;
    if (normalized && !absolute[3] && normalized < dateOnly(addUtcDays(now, -1))) {
      normalized = normalizeDatePart(`${absolute[1]} ${absolute[2]}, ${now.getUTCFullYear() + 1}`) ?? normalized;
    }
    return normalized;
  }

  return undefined;
}

function isTimelineHeading(text: string): boolean {
  return Boolean(resolveLumaTimelineHeadingDate(text, new Date(Date.UTC(2026, 6, 15))));
}

function extractVisibleTime(text: string): string | undefined {
  return text.match(/\b(?:\d{1,2}(?::\d{2})?\s*(?:AM|PM)|All Day)\b/i)?.[0];
}

function lumaCardSelector(): string {
  return "article.event-card, article[data-testid='event'], .event-card, main article, a.event-link[href], a.content-link[href]";
}

export function extractLumaTimelineCards(
  $: cheerio.CheerioAPI,
  baseUrl = LUMA_BASE,
  now: Date = new Date(),
): ParsedLumaEvent[] {
  const cards: ParsedLumaEvent[] = [];
  const seenElements = new Set<unknown>();
  let currentHeading: string | undefined;

  $("body *").each((_index, element) => {
    const node = $(element);
    const text = node.clone().children().remove().end().text().replace(/\s+/g, " ").trim();
    const tag = String((element as { tagName?: string }).tagName ?? "").toLowerCase();
    if ((/^h[1-6]$/.test(tag) || node.attr("role") === "heading") && text.length <= 60 && isTimelineHeading(text)) {
      currentHeading = text;
      return;
    }

    if (!node.is(lumaCardSelector())) return;
    if (node.parents(lumaCardSelector()).length > 0) return;
    if (seenElements.has(element)) return;
    seenElements.add(element);

    const headingDate = resolveLumaTimelineHeadingDate(currentHeading, now);
    if (!headingDate) return;
    const title =
      node.find("h1, h2, h3, .title, [data-testid='event-title']").first().text().trim() ||
      node.attr("aria-label")?.trim() ||
      "";
    const href =
      node.is("a[href]") ? node.attr("href") : node.find("a[href]").first().attr("href");
    const url = href ? normalizeUrl(href, baseUrl) : undefined;
    const fullText = node.text().replace(/\s+/g, " ").trim();
    const timelineTime =
      node.find("time").first().text().trim() ||
      node.find("[datetime]").first().attr("datetime")?.trim() ||
      extractVisibleTime(fullText);
    const location =
      node
        .find(".location, .venue, [data-testid='location']")
        .first()
        .text()
        .replace(/\s+/g, " ")
        .trim() || undefined;
    if (!title && !url) return;
    cards.push({
      title: title || "Untitled Luma event",
      url,
      dateText: [currentHeading, timelineTime].filter(Boolean).join(" "),
      startDate: headingDate,
      location,
      mode: parseMode(location ?? "", fullText),
      description: fullText.slice(0, 280),
      registration: undefined,
      externalLinks: [],
      pageKind: "event",
      timelineHeading: currentHeading,
      timelineTime,
    });
  });

  return cards;
}

function toEventUrl(slugOrUrl: string | undefined): string | undefined {
  if (!slugOrUrl) return undefined;
  if (/^https?:\/\//i.test(slugOrUrl)) {
    return normalizeUrl(slugOrUrl, LUMA_BASE);
  }
  return normalizeUrl(`/${slugOrUrl.replace(/^\//, "")}`, LUMA_BASE);
}

/** Reject non-event Luma surfaces as candidate leads. */
export function classifyLumaPageUrl(url: string): ParsedLumaEvent["pageKind"] {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes("lu.ma") && !host.includes("luma.com")) return "unknown";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    if (path === "/discover" || path.startsWith("/discover/")) return "discover";
    if (
      path === "/home" ||
      path.startsWith("/home/") ||
      path.includes("/calendar") ||
      path === "/calendars" ||
      path.startsWith("/user/") ||
      path.startsWith("/u/") ||
      path === "/signin" ||
      path === "/login"
    ) {
      return path.includes("calendar") ? "calendar" : "profile";
    }
    // City hubs like /toronto are calendars of many events, not a single event.
    if (/^\/[a-z0-9_-]+$/i.test(path) && !/^\/[a-z0-9]{6,}$/i.test(path)) {
      // Ambiguous: short city slugs vs event slugs. Prefer next-data kind when available.
      return "unknown";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function isRejectedLumaLeadUrl(url: string | undefined): boolean {
  if (!url) return true;
  const kind = classifyLumaPageUrl(url);
  return kind === "discover" || kind === "calendar" || kind === "profile";
}

function isUpcoming(startAt?: string, endAt?: string, now = new Date()): boolean {
  const end = endAt ? new Date(endAt) : startAt ? new Date(startAt) : undefined;
  if (!end || Number.isNaN(end.getTime())) return true; // keep when unknown; downstream filters
  // Allow a small grace window for ongoing events.
  return end.getTime() >= now.getTime() - 6 * 60 * 60 * 1000;
}

const VERIFIED_LOCATION_FEEDS: Record<string, LumaFeedConfig> = {
  toronto: {
    mode: "luma_toronto",
    label: "Toronto",
    url: `${LUMA_BASE}/toronto`,
    type: "location",
  },
  waterloo: {
    mode: "luma_waterloo",
    label: "Waterloo",
    url: `${LUMA_BASE}/waterloo`,
    type: "location",
  },
};

const AI_FEED: LumaFeedConfig = {
  mode: "luma_ai",
  label: "AI",
  url: `${LUMA_BASE}/ai`,
  type: "topic",
};
const HACKATHON_FEED: LumaFeedConfig = {
  mode: "luma_hackathon",
  label: "Hackathon search",
  url: `${LUMA_BASE}/discover?q=hackathon`,
  type: "topic",
};
const AI_HACKATHON_FEED: LumaFeedConfig = {
  mode: "luma_ai_hackathon",
  label: "AI hackathon search",
  url: `${LUMA_BASE}/discover?q=${encodeURIComponent("AI hackathon")}`,
  type: "topic",
};
const ARTIFICIAL_INTELLIGENCE_FEED: LumaFeedConfig = {
  mode: "luma_artificial_intelligence",
  label: "Artificial intelligence search",
  url: `${LUMA_BASE}/discover?q=${encodeURIComponent("artificial intelligence")}`,
  type: "topic",
};
const REMOTE_FEED: LumaFeedConfig = {
  mode: "luma_remote",
  label: "Remote/online search",
  url: `${LUMA_BASE}/discover?q=${encodeURIComponent("online hackathon")}`,
  type: "topic",
};
const TECH_FEED: LumaFeedConfig = {
  mode: "luma_tech",
  label: "Tech",
  url: `${LUMA_BASE}/tech`,
  type: "topic",
};

function requestedLumaLocation(input: CollectorInput): string | undefined {
  const command = input.preferences.rawCommand.toLowerCase();
  for (const city of Object.keys(VERIFIED_LOCATION_FEEDS)) {
    if (new RegExp(`\\b(?:in|near|around|for)\\s+${city}\\b|\\b${city}\\b`, "i").test(command)) {
      return city;
    }
  }
  if (/\bontario\b/i.test(command)) return "ontario";
  return undefined;
}

function wantsAiTopic(topics: string[] | undefined, command = ""): boolean {
  const haystack = `${(topics ?? []).join(" ")} ${command}`.toLowerCase();
  return /\b(ai|artificial intelligence|agents?|llm|machine learning|ml)\b/i.test(haystack);
}

/** AI-themed Luma topic routes — provenance only, not content confirmation. */
export const LUMA_AI_THEME_FEEDS = new Set<LumaDiscoveryFeed>([
  "luma_ai",
  "luma_ai_hackathon",
  "luma_artificial_intelligence",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when the event was discovered on an AI-themed feed/search route.
 * Feed provenance alone is never confirmed content-theme relevance.
 */
export function isLumaFeedThemeCandidate(
  discoveredFrom: Iterable<string> | undefined,
  themes: string[],
  command = "",
): boolean {
  if (!discoveredFrom) return false;
  if (!wantsAiTopic(themes, command)) return false;
  for (const feed of discoveredFrom) {
    if (LUMA_AI_THEME_FEEDS.has(feed as LumaDiscoveryFeed)) return true;
  }
  return false;
}

/**
 * Content/title/description theme match only.
 * Does not inspect feed names, discoveredFrom, or provenance-bearing lead.text.
 * Empty themes → false (unspecified is not a content match).
 */
export function leadContentMatchesTheme(lead: RawLead, themes: string[]): boolean {
  if (themes.length === 0) return false;
  const description =
    typeof lead.metadata?.description === "string" ? lead.metadata.description : "";
  // Ignore provenance-bearing collector stubs; keep real listing descriptions in text.
  const text =
    typeof lead.text === "string" && !/discovered from/i.test(lead.text) ? lead.text : "";
  const haystack = `${lead.title ?? ""} ${description} ${text}`.trim();
  if (!haystack) return false;

  return themes.some((theme) => {
    const needle = theme.trim();
    if (!needle) return false;
    // Short tokens (AI, ML) require word boundaries so "PAIRS" / "luma_ai" do not false-positive.
    if (needle.length <= 3) {
      return new RegExp(`\\b${escapeRegExp(needle)}\\b`, "i").test(haystack);
    }
    return haystack.toLowerCase().includes(needle.toLowerCase());
  });
}

export function resolveLumaFeeds(input: {
  requestedLocation?: string;
  requestedTopics?: string[];
  rawCommand?: string;
  remotePolicy?: string;
}): LumaFeedResolution {
  const feeds: LumaFeedConfig[] = [];
  const requestedLocation = input.requestedLocation?.trim();
  const key = requestedLocation?.toLowerCase();
  const command = input.rawCommand ?? "";
  const aiFirst = wantsAiTopic(input.requestedTopics, command);
  const wantsRemote =
    input.remotePolicy === "include" ||
    input.remotePolicy === "only" ||
    /\b(remote|online|virtual)\b/i.test(command);

  if (key === "ontario") {
    feeds.push(VERIFIED_LOCATION_FEEDS.toronto, VERIFIED_LOCATION_FEEDS.waterloo);
  } else if (key && VERIFIED_LOCATION_FEEDS[key]) {
    feeds.push(VERIFIED_LOCATION_FEEDS[key]);
  }

  // Primary search/feed routes with independent reserved budgets later.
  // Tech is last so it cannot starve hackathon/AI discovery.
  if (aiFirst) {
    feeds.push(
      HACKATHON_FEED,
      AI_HACKATHON_FEED,
      ARTIFICIAL_INTELLIGENCE_FEED,
      AI_FEED,
      TECH_FEED,
    );
  } else {
    feeds.push(HACKATHON_FEED, AI_FEED, TECH_FEED);
  }
  if (wantsRemote) feeds.push(REMOTE_FEED);

  const unique = new Map<string, LumaFeedConfig>();
  for (const feed of feeds) unique.set(feed.url, feed);

  return {
    requestedLocation,
    feeds: [...unique.values()],
    fallbackReason:
      key && key !== "ontario" && !VERIFIED_LOCATION_FEEDS[key]
        ? `No verified ${requestedLocation} city feed available`
        : undefined,
  };
}

function buildDiscoveryFeeds(input: CollectorInput): LumaFeedResolution {
  const requestedLocation = requestedLumaLocation(input);
  return resolveLumaFeeds({
    requestedLocation,
    requestedTopics: input.preferences.themes,
    rawCommand: input.preferences.rawCommand,
    remotePolicy: input.preferences.remotePolicy,
  });
}

/** Even reserved budgets — first feed must not consume the entire source timeout. */
export function allocateLumaFeedBudgets(
  total: LumaProfileBudget,
  feedCount: number,
): LumaProfileBudget[] {
  const count = Math.max(1, feedCount);
  const baseScrolls = Math.max(1, Math.floor(total.maxScrolls / count));
  const leftoverScrolls = Math.max(0, total.maxScrolls - baseScrolls * count);
  const baseEvents = Math.max(1, Math.floor(total.maxEvents / count));
  const leftoverEvents = Math.max(0, total.maxEvents - baseEvents * count);
  return Array.from({ length: count }, (_, index) => ({
    maxEvents: baseEvents + (index < leftoverEvents ? 1 : 0),
    maxScrolls: baseScrolls + (index < leftoverScrolls ? 1 : 0),
    detailLimit: total.detailLimit,
    targetEvents: total.targetEvents,
    stopAtTarget: total.stopAtTarget,
  }));
}

function leadLooksHackathon(lead: RawLead): boolean {
  return isLikelyHackathon(lead.title ?? "", lead.text ?? "");
}

function extractNextData($: cheerio.CheerioAPI): unknown | undefined {
  const raw = $("#__NEXT_DATA__").html();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function walkLumaEvents(node: unknown, out: ParsedLumaEvent[] = [], depth = 0): ParsedLumaEvent[] {
  if (!node || depth > 12 || out.length > 80) return out;
  if (Array.isArray(node)) {
    for (const item of node) walkLumaEvents(item, out, depth + 1);
    return out;
  }
  if (typeof node !== "object") return out;

  const record = node as Record<string, unknown>;
  const apiId = typeof record.api_id === "string" ? record.api_id : undefined;
  const name = typeof record.name === "string" ? record.name : undefined;
  const startAt = typeof record.start_at === "string" ? record.start_at : undefined;
  const endAt = typeof record.end_at === "string" ? record.end_at : undefined;
  const url = typeof record.url === "string" ? record.url : undefined;
  const looksLikeEvent =
    Boolean(name) &&
    (Boolean(startAt) || (typeof apiId === "string" && apiId.startsWith("evt-")));

  // Skip place/calendar directory objects that also have name+url but no event timing.
  const isPlace =
    typeof apiId === "string" &&
    (apiId.startsWith("discplace-") || apiId.startsWith("cal-"));

  if (looksLikeEvent && !isPlace) {
    const geo = record.geo_address_info as Record<string, unknown> | undefined;
    const location =
      (typeof geo?.full_address === "string" && geo.full_address) ||
      (typeof geo?.city_state === "string" && geo.city_state) ||
      (typeof record.timezone === "string" ? record.timezone : undefined);
    const locationType =
      typeof record.location_type === "string" ? record.location_type : undefined;
    const description =
      typeof record.description_short === "string"
        ? record.description_short
        : typeof record.description === "string"
          ? record.description
          : undefined;

    out.push({
      title: name!,
      url: toEventUrl(url),
      apiId,
      dateText: startAt,
      startDate: extractIsoDate(startAt),
      endDate: extractIsoDate(endAt),
      location,
      mode: parseMode(location ?? "", description ?? "", locationType),
      description,
      externalLinks: [],
      pageKind: "event",
    });
  }

  for (const value of Object.values(record)) {
    walkLumaEvents(value, out, depth + 1);
  }
  return out;
}

function extractEventFromInitialData(initialData: unknown, pageUrl: string): ParsedLumaEvent[] {
  if (!initialData || typeof initialData !== "object") return [];
  const root = initialData as Record<string, unknown>;
  const kind = typeof root.kind === "string" ? root.kind : undefined;
  const data = (root.data ?? root) as Record<string, unknown>;

  if (kind === "event" || data.event) {
    const event = (data.event ?? data) as Record<string, unknown>;
    const hosts = Array.isArray(data.hosts) ? data.hosts : [];
    const hostName =
      hosts
        .map((h) =>
          h && typeof h === "object" && typeof (h as { name?: string }).name === "string"
            ? (h as { name: string }).name
            : undefined,
        )
        .find(Boolean) ||
      (data.calendar &&
      typeof data.calendar === "object" &&
      typeof (data.calendar as { name?: string }).name === "string"
        ? (data.calendar as { name: string }).name
        : undefined);

    const geo = event.geo_address_info as Record<string, unknown> | undefined;
    const location =
      (typeof geo?.full_address === "string" && geo.full_address) ||
      (typeof geo?.city_state === "string" && geo.city_state) ||
      undefined;
    const registration =
      typeof data.registration_availability === "string"
        ? data.registration_availability
        : data.sold_out
          ? "sold_out"
          : data.waitlist_active
            ? "waitlist"
            : undefined;

    const title = typeof event.name === "string" ? event.name : undefined;
    if (!title) return [];

    return [
      {
        title,
        url: toEventUrl(typeof event.url === "string" ? event.url : pageUrl) ?? pageUrl,
        apiId: typeof event.api_id === "string" ? event.api_id : undefined,
        organizer: hostName,
        dateText: typeof event.start_at === "string" ? event.start_at : undefined,
        startDate: extractIsoDate(
          typeof event.start_at === "string" ? event.start_at : undefined,
        ),
        endDate: extractIsoDate(typeof event.end_at === "string" ? event.end_at : undefined),
        location,
        mode: parseMode(
          location ?? "",
          "",
          typeof event.location_type === "string" ? event.location_type : undefined,
        ),
        description: undefined,
        registration,
        externalLinks: [],
        pageKind: "event",
      },
    ];
  }

  // City / discover payloads: walk for embedded evt-* objects.
  return walkLumaEvents(initialData);
}

function extractEventCards($: cheerio.CheerioAPI, baseUrl: string): ParsedLumaEvent[] {
  const cards: ParsedLumaEvent[] = [];
  const roots = $(
    "article.event-card, article[data-testid='event'], .event-card, main article",
  ).toArray();

  for (const element of roots) {
    const root = $(element);
    const title =
      root.find("h1, h2, h3, .title, [data-testid='event-title']").first().text().trim() || "";
    const href =
      root.find("a[href*='lu.ma/'], a[href*='luma.com/']").first().attr("href") ||
      root.find("a[href]").first().attr("href");
    const url = href ? normalizeUrl(href, baseUrl) : undefined;
    const organizer =
      root.find(".organizer, [data-testid='organizer'], .host").first().text().trim() ||
      undefined;
    const timeEl = root.find("time").first();
    const dateText =
      timeEl.attr("datetime")?.trim() ||
      timeEl.text().trim() ||
      root.find(".date, .when").first().text().trim() ||
      undefined;
    const location =
      root
        .find(".location, .venue, [data-testid='location']")
        .first()
        .text()
        .replace(/\s+/g, " ")
        .trim() || undefined;
    const description =
      root.find(".description, p").first().text().replace(/\s+/g, " ").trim() || undefined;
    const registration =
      root.find(".registration, .status, [data-testid='registration']").first().text().trim() ||
      undefined;

    const externalLinks = uniqueUrls(
      root
        .find("a[href]")
        .map((_i, node) => $(node).attr("href") ?? "")
        .get()
        .filter((link) => {
          try {
            const host = new URL(link, baseUrl).hostname.toLowerCase();
            return !host.includes("lu.ma") && !host.includes("luma.com");
          } catch {
            return false;
          }
        }),
      baseUrl,
    );

    if (!title && !url) continue;

    cards.push({
      title: title || "Untitled Luma event",
      url,
      organizer,
      dateText,
      startDate: extractIsoDate(dateText),
      location,
      mode: parseMode(location ?? "", description ?? ""),
      description,
      registration,
      externalLinks,
      pageKind: "event",
    });
  }

  return cards;
}

export function parseLumaHtml(
  html: string,
  maxResults: number,
  baseUrl = LUMA_BASE,
  discoveryMode: LumaDiscoveryFeed | "luma_public" = "luma_public",
  now: Date = new Date(),
): RawLead[] {
  const $ = cheerio.load(html);
  const pageKind = classifyLumaPageUrl(baseUrl);

  const next = extractNextData($) as
    | { page?: string; props?: { pageProps?: { initialData?: unknown } } }
    | undefined;
  const initialData = next?.props?.pageProps?.initialData;
  let cards: ParsedLumaEvent[] = [];

  if (initialData) {
    cards = extractEventFromInitialData(initialData, baseUrl);
  }

  if (cards.length === 0) {
    cards = extractEventCards($, baseUrl);
  }

  const timelineCards = extractLumaTimelineCards($, baseUrl, now);
  if (timelineCards.length > 0) {
    const byKey = new Map<string, ParsedLumaEvent>();
    for (const card of cards) {
      byKey.set(card.url ? normalizeUrlForDedupe(card.url) : slugify(card.title), card);
    }
    for (const card of timelineCards) {
      const key = card.url ? normalizeUrlForDedupe(card.url) : slugify(card.title);
      const existing = byKey.get(key);
      byKey.set(key, {
        ...card,
        ...existing,
        dateText: existing?.dateText ?? card.dateText,
        startDate: existing?.startDate ?? card.startDate,
        timelineHeading: existing?.timelineHeading ?? card.timelineHeading,
        timelineTime: existing?.timelineTime ?? card.timelineTime,
      });
    }
    cards = [...byKey.values()];
  }

  // og: tags only when this is clearly a single event page — never for discover/calendar hubs.
  if (cards.length === 0 && pageKind !== "discover" && pageKind !== "calendar") {
    const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
    const ogUrl = $('meta[property="og:url"]').attr("content")?.trim();
    const ogDesc = $('meta[property="og:description"]').attr("content")?.trim();
    const ogLooksLikeDiscover = /discover events/i.test(ogTitle ?? "");
    if ((ogTitle || ogUrl) && !ogLooksLikeDiscover) {
      cards.push({
        title: ogTitle || "Luma event",
        url: ogUrl ? normalizeUrl(ogUrl, baseUrl) : undefined,
        description: ogDesc,
        externalLinks: [],
        mode: parseMode("", ogDesc ?? ""),
        pageKind: "event",
      });
    }
  }

  const leads: RawLead[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    if (card.pageKind && card.pageKind !== "event" && card.pageKind !== "unknown") continue;
    if (isRejectedLumaLeadUrl(card.url)) continue;
    if (!isUpcoming(card.startDate ?? card.dateText, card.endDate)) continue;

    const dedupeKey = card.url
      ? normalizeUrlForDedupe(card.url)
      : card.apiId
        ? slugify(card.apiId)
        : slugify(card.title);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const applyUrl = card.externalLinks[0];
    const eventUrl = card.url;
    if (!eventUrl || isRejectedLumaLeadUrl(eventUrl)) continue;

    const links = uniqueUrls(
      [eventUrl, applyUrl, ...card.externalLinks].filter(Boolean) as string[],
      baseUrl,
    );

    leads.push({
      id: `luma-${slugify(eventUrl ? new URL(eventUrl).pathname : card.title)}`,
      source: "luma",
      title: card.title,
      url: eventUrl,
      text: [card.organizer, card.dateText, card.location, card.description, card.registration]
        .filter(Boolean)
        .join(" - "),
      links,
      postedAt: new Date().toISOString(),
      metadata: {
        organizer: card.organizer,
        dateText: card.dateText,
        startDate: card.startDate,
        endDate: card.endDate,
        timelineHeading: card.timelineHeading,
        timelineTime: card.timelineTime,
        timezone: card.timezone,
        dateExtractionState: card.timelineHeading ? "found_on_listing_timeline" : undefined,
        location: card.mode === "online" ? "Online" : card.location,
        mode: card.mode,
        registration: card.registration,
        officialUrl: applyUrl ?? eventUrl,
        applyUrl: applyUrl ?? eventUrl,
        attribution: "luma",
        provenance: "luma_public",
        lumaMode: "public",
        discoveryMode: card.discoveryMode ?? discoveryMode,
        discoveredFrom: card.discoveredFrom ?? [card.discoveryMode ?? discoveryMode],
        sourceIds: {
          luma: card.apiId ?? (eventUrl ? slugify(new URL(eventUrl).pathname) : slugify(card.title)),
        },
      },
    });

    if (leads.length >= maxResults) break;
  }

  return leads;
}

/** Alias for fixture/event-page parsing. */
export const parseLumaEventHtml = parseLumaHtml;

async function fetchLumaPage(
  url: string,
  timeoutMs: number,
): Promise<{ html: string; finalUrl: string; warnings: string[] }> {
  const warnings: string[] = [];
  try {
    const html = await fetchHtml(url, { timeoutMs, retries: 1 });
    return { html, finalUrl: url, warnings };
  } catch (error) {
    if (error instanceof FetchHtmlError) {
      if (error.status === 429) {
        warnings.push(describeLumaFailure("rate_limit", error.message));
      } else if (error.status === 403 || error.status === 503) {
        warnings.push(describeLumaFailure("anti_bot", error.message));
      } else {
        warnings.push(describeLumaFailure("network", error.message));
      }
    } else {
      warnings.push(error instanceof Error ? error.message : `Failed to fetch ${url}`);
    }

    try {
      const rendered = await withPlaywright(
        async ({ page }) => {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
          await page
            .locator("article, h1, #__NEXT_DATA__, [data-testid='event']")
            .first()
            .waitFor({ state: "attached", timeout: Math.min(timeoutMs, 6_000) })
            .catch(() => {
              warnings.push("Luma page content did not fully render within timeout.");
            });
          return { html: await page.content(), finalUrl: page.url() };
        },
        { timeoutMs },
      );
      return { ...rendered, warnings };
    } catch (playwrightError) {
      if (isPlaywrightBrowserMissingError(playwrightError)) {
        warnings.push(describeLumaFailure("browser_missing"));
      } else {
        warnings.push(
          playwrightError instanceof Error
            ? playwrightError.message
            : "Luma Playwright fallback failed",
        );
      }
      return { html: "", finalUrl: url, warnings };
    }
  }
}

function isLikelyLumaEventUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, LUMA_BASE);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes("luma.com") && !host.includes("lu.ma")) return false;
    const path = parsed.pathname.replace(/\/+$/, "");
    if (!/^\/[a-z0-9][a-z0-9_-]{4,}$/i.test(path)) return false;
    if (
      /^\/(about|ai|calendar|calendars|discover|explore|home|login|pricing|search|signin|tech|toronto|waterloo|u|user)$/i.test(
        path,
      )
    ) {
      return false;
    }
    if (parsed.searchParams.get("k") === "c") return false;
    return true;
  } catch {
    return false;
  }
}

async function collectLumaEventUrlsFromPage(
  page: Page,
  discoveryMode: LumaDiscoveryFeed,
  maxEvents = LUMA_MAX_EVENTS,
): Promise<string[]> {
  const urls = await page.evaluate(() => {
    const anchors = [
      ...document.querySelectorAll<HTMLAnchorElement>("a.event-link[href], a.content-link[href]"),
      ...document.querySelectorAll<HTMLAnchorElement>("a[href^='/'], a[href*='luma.com/']"),
    ];
    return anchors
      .map((anchor) => anchor.href)
      .filter(Boolean)
      .filter((href) => {
        try {
          const parsed = new URL(href);
          const path = parsed.pathname.replace(/\/+$/, "");
          if (parsed.searchParams.get("k") === "c") return false;
          if (!/^\/[a-z0-9][a-z0-9_-]{4,}$/i.test(path)) return false;
          return !/^\/(about|ai|calendar|calendars|discover|explore|home|login|pricing|search|signin|tech|toronto|waterloo|u|user)$/i.test(
            path,
          );
        } catch {
          return false;
        }
      });
  });
  const domUrls = uniqueUrls(urls, LUMA_BASE).filter(isLikelyLumaEventUrl);
  if (domUrls.length > 0) return domUrls;

  const html = await page.content().catch(() => "");
  if (!html) return [];
  return parseLumaHtml(html, maxEvents, page.url(), discoveryMode)
    .map((lead) => lead.url)
    .filter((url): url is string => Boolean(url))
    .filter(isLikelyLumaEventUrl);
}

async function collectLumaLeadsFromPage(
  page: Page,
  discoveryMode: LumaDiscoveryFeed,
  maxEvents = LUMA_MAX_EVENTS,
): Promise<RawLead[]> {
  const html = await page.content().catch(() => "");
  if (!html) return [];
  const leads = parseLumaHtml(html, maxEvents, page.url(), discoveryMode)
    .filter((lead) => lead.url && isLikelyLumaEventUrl(lead.url));
  if (leads.length > 0) return leads;
  return (await collectLumaEventUrlsFromPage(page, discoveryMode, maxEvents)).map((url) => ({
    id: `luma-${slugify(new URL(url).pathname)}`,
    source: "luma" as const,
    title: "Luma event",
    url,
    text: `Luma public event - discovered from ${discoveryMode}`,
    links: [url],
    postedAt: new Date().toISOString(),
    metadata: {
      officialUrl: url,
      applyUrl: url,
      attribution: "luma",
      provenance: "luma_public",
      lumaMode: "public",
      discoveryMode,
      discoveredFrom: [discoveryMode],
      sourceIds: { luma: slugify(new URL(url).pathname) },
    },
  }));
}

async function collectRenderedLumaFeed(
  feed: LumaFeedConfig,
  timeoutMs: number,
  budget: LumaProfileBudget,
  logger?: (message: string) => void,
): Promise<LumaFeedCollection> {
  const warnings: string[] = [];
  logger?.(`Opening ${feed.label} discovery page...`);

  try {
    return await withPlaywright(
      async ({ page }) => {
        await page.goto(feed.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        await page
          .locator("a.event-link[href], a.content-link[href]")
          .first()
          .waitFor({ state: "attached", timeout: Math.min(timeoutMs, 8_000) })
          .catch(() => {
            warnings.push(`${feed.label} event cards did not fully render within timeout.`);
          });
        await page.waitForTimeout(500);

        const collected = await collectUntilStable<RawLead>({
          collectItems: () => collectLumaLeadsFromPage(page, feed.mode, budget.maxEvents),
          getKey: (lead) => normalizeUrlForDedupe(lead.url ?? lead.id),
          scroll: async () => {
            await page.mouse.wheel(0, 2_400);
          },
          waitForIdle: async () => {
            await page
              .waitForLoadState("networkidle", { timeout: LUMA_SCROLL_WAIT_MS })
              .catch(() => undefined);
          },
          maxItems: budget.maxEvents,
          maxScrolls: budget.maxScrolls,
          noGrowthLimit: LUMA_NO_GROWTH_LIMIT,
          timeoutMs,
          waitMs: LUMA_SCROLL_WAIT_MS,
          logger,
          loadingMessage: "Loading more events...",
          countMessage: (count) =>
            count === 1 ? "1 unique event found" : `${count} unique events found`,
        });

        if (collected.noGrowthAttempts >= LUMA_NO_GROWTH_LIMIT) {
          logger?.(`No additional events after ${LUMA_NO_GROWTH_LIMIT} attempts`);
        }
        logger?.("Lazy loading complete");

        return {
          feed,
          urls: collected.items.map((lead) => lead.url).filter((url): url is string => Boolean(url)),
          leads: collected.items,
          uniqueCount: collected.uniqueCount,
          scrollAttempts: collected.scrollAttempts,
          noGrowthAttempts: collected.noGrowthAttempts,
          stopReason: collected.stopReason,
          warnings,
        };
      },
      { timeoutMs },
    );
  } catch (error) {
    if (isPlaywrightBrowserMissingError(error)) {
      warnings.push(describeLumaFailure("browser_missing"));
    } else {
      warnings.push(error instanceof Error ? error.message : `${feed.label} render failed`);
    }
    return {
      feed,
      urls: [],
      leads: [],
      uniqueCount: 0,
      scrollAttempts: 0,
      noGrowthAttempts: 0,
      stopReason: "page_failed",
      warnings,
    };
  }
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

async function enrichEventPages(
  leads: RawLead[],
  timeoutMs: number,
  startedAt: number,
  detailLimit: number,
  shouldEnrich: (lead: RawLead) => boolean,
): Promise<{ leads: RawLead[]; warnings: string[]; opened: number; failures: number }> {
  const warnings: string[] = [];
  let opened = 0;
  let failures = 0;

  const targets = new Set(leads.filter(shouldEnrich).slice(0, detailLimit).map((lead) => lead.id));

  const enriched = await mapLimit(leads, DETAIL_PAGE_CONCURRENCY, async (lead) => {
    if (!lead.url || Date.now() - startedAt > timeoutMs || !targets.has(lead.id)) {
      return lead;
    }

    try {
      const remaining = Math.min(
        LUMA_DETAIL_TIMEOUT_MS,
        Math.max(1_500, timeoutMs - (Date.now() - startedAt)),
      );
      opened += 1;
      const page = await fetchLumaPage(lead.url, remaining);
      warnings.push(...page.warnings);
      if (!page.html) {
        failures += 1;
        return lead;
      }
      const detailLeads = parseLumaHtml(
        page.html,
        1,
        page.finalUrl || lead.url,
        (lead.metadata?.discoveryMode as LumaDiscoveryFeed | undefined) ?? "luma_public",
      );
      const detail = detailLeads[0];
      if (!detail) {
        failures += 1;
        return lead;
      }
      return {
        ...lead,
        title: detail.title || lead.title,
        text: detail.text || lead.text,
        links: uniqueUrls([...lead.links, ...detail.links], LUMA_BASE),
        metadata: {
          ...lead.metadata,
          ...detail.metadata,
          discoveredFrom: lead.metadata?.discoveredFrom ?? detail.metadata?.discoveredFrom,
          enriched: true,
        },
      };
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "Luma enrich failed");
      failures += 1;
      return lead;
    }
  });

  return { leads: enriched, warnings, opened, failures };
}

function lumaListingDataIsSufficient(lead: RawLead): boolean {
  const title = (lead.title ?? "").replace(/\s+/g, " ").trim();
  const metadata = lead.metadata ?? {};
  return (
    title.length > 3 &&
    !/^luma event$/i.test(title) &&
    Boolean(metadata.startDate || metadata.dateText) &&
    Boolean(metadata.location || (lead.text ?? "").length > 20)
  );
}

export const lumaCollector: Collector = {
  source: "luma",

  async collect(input: CollectorInput): Promise<CollectorResult> {
    const startedAt = Date.now();
    const result = emptyCollectorResult("luma", startedAt);
    const mode = resolveLumaDiscoveryMode();
    const feedResolution = buildDiscoveryFeeds(input);
    const feeds = feedResolution.feeds;
    const budget = lumaBudgetForProfile(input.preferences.profile, input.maxResults);
    const byUrl = new Map<string, { url: string; feeds: Set<LumaDiscoveryFeed>; lead?: RawLead }>();
    const budgetMs = input.timeoutMs;
    let pagesFetched = 0;
    let scrollAttempts = 0;
    let noGrowthAttempts = 0;
    let uniqueCards = 0;
    const stopReasons: string[] = [];

    result.warnings.push(`luma_mode=${mode}`);

    if (mode === "authenticated") {
      // Stub: same persistent-browser architecture as Hakku would apply, but optional.
      result.warnings.push(
        "Luma connected mode is unavailable (optional persistent-browser auth not implemented); continuing with public discovery only.",
      );
    }
    input.logger?.("Starting public discovery...");
    if (feedResolution.requestedLocation) {
      input.logger?.(`Requested location: ${feedResolution.requestedLocation}`);
    }
    const locationFeeds = feeds.filter((feed) => feed.type === "location");
    const topicFeeds = feeds.filter((feed) => feed.type === "topic");
    if (locationFeeds.length > 0) {
      input.logger?.(`Location feed: ${locationFeeds.map((feed) => feed.label).join(", ")}`);
    } else if (feedResolution.fallbackReason) {
      input.logger?.(feedResolution.fallbackReason);
      input.logger?.(
        `Using ${topicFeeds.map((feed) => feed.label).join(" and ")} feeds with location filtering`,
      );
    }
    input.logger?.(
      `Topic feeds (priority order): ${topicFeeds.map((feed) => feed.label).join(", ")}`,
    );

    const feedBudgets = allocateLumaFeedBudgets(budget, feeds.length);

    try {
      // Phase 1: collect event cards from every primary route before classification.
      for (let feedIndex = 0; feedIndex < feeds.length; feedIndex += 1) {
        const feed = feeds[feedIndex]!;
        if (Date.now() - startedAt > budgetMs) {
          result.warnings.push("Luma collector stopped early after timeout budget.");
          stopReasons.push(`${feed.mode}:timeout_before_start`);
          break;
        }
        // Independent reserved timeout slice — Tech cannot consume the whole deadline.
        const perFeedTimeout = Math.max(
          6_000,
          Math.floor(budgetMs / Math.max(1, feeds.length)),
        );
        const remaining = Math.min(
          perFeedTimeout,
          Math.max(1_000, budgetMs - (Date.now() - startedAt)),
        );
        const feedBudget = feedBudgets[feedIndex]!;
        input.logger?.(
          `[${feed.label}] reserved budget ${feedBudget.maxScrolls} scrolls / ${feedBudget.maxEvents} events (${remaining}ms)`,
        );
        const feedResult = await collectRenderedLumaFeed(feed, remaining, feedBudget, input.logger);
        pagesFetched += 1;
        result.warnings.push(...feedResult.warnings);
        scrollAttempts += feedResult.scrollAttempts;
        noGrowthAttempts += feedResult.noGrowthAttempts;
        uniqueCards += feedResult.uniqueCount;
        stopReasons.push(`${feed.mode}:${feedResult.stopReason}`);
        result.warnings.push(`stop_reason_${feed.mode}=${feedResult.stopReason}`);
        result.warnings.push(`unique_cards_${feed.mode}=${feedResult.uniqueCount}`);
        result.warnings.push(`scrolls_${feed.mode}=${feedResult.scrollAttempts}`);
        result.warnings.push(`no_growth_${feed.mode}=${feedResult.noGrowthAttempts}`);
        input.logger?.(
          `[${feed.label}] collected ${feedResult.uniqueCount} unique event cards (classification deferred)`,
        );

        for (const lead of feedResult.leads) {
          if (!lead.url) continue;
          const key = normalizeUrlForDedupe(lead.url);
          const existing = byUrl.get(key);
          if (existing) {
            existing.feeds.add(feed.mode);
            if (!existing.lead || !lumaListingDataIsSufficient(existing.lead)) existing.lead = lead;
          } else {
            byUrl.set(key, { url: lead.url, feeds: new Set([feed.mode]), lead });
          }
        }

        for (const url of feedResult.urls) {
          const key = normalizeUrlForDedupe(url);
          const existing = byUrl.get(key);
          if (existing) {
            existing.feeds.add(feed.mode);
          } else {
            byUrl.set(key, { url, feeds: new Set([feed.mode]) });
          }
        }
      }

      const provisionalLeads = [...byUrl.values()]
        .slice(0, budget.maxEvents)
        .map(({ url, feeds, lead }) => {
          const discoveredFrom = [...feeds];
          const primaryFeed = discoveredFrom[0] ?? "luma_public";
          if (lead && lumaListingDataIsSufficient(lead)) {
            return {
              ...lead,
              metadata: {
                ...lead.metadata,
                officialUrl: lead.metadata?.officialUrl ?? url,
                applyUrl: lead.metadata?.applyUrl ?? url,
                discoveryMode: primaryFeed,
                discoveredFrom,
              },
            } satisfies RawLead;
          }
          return {
            id: `luma-${slugify(new URL(url).pathname)}`,
            source: "luma" as const,
            title: "Luma event",
            url,
            text: `Luma public event - discovered from ${discoveredFrom.join(", ")}`,
            links: [url],
            postedAt: new Date().toISOString(),
            metadata: {
              officialUrl: url,
              applyUrl: url,
              attribution: "luma",
              provenance: "luma_public",
              lumaMode: "public",
              discoveryMode: primaryFeed,
              discoveredFrom,
              sourceIds: { luma: slugify(new URL(url).pathname) },
            },
          } satisfies RawLead;
        });

      // Phase 2: classify after all feeds are collected (not inside scroll loops).
      // Keep feed provenance and content-theme matches as separate metrics.
      let classifiedHackathon = 0;
      let feedThemeCandidate = 0;
      let contentThemeMatched = 0;
      let queryRelevantEstimate = 0;
      const classifiedFlags = new Map<
        string,
        { hackathon: boolean; feedTheme: boolean; contentTheme: boolean }
      >();
      for (const lead of provisionalLeads) {
        const entry = lead.url ? byUrl.get(normalizeUrlForDedupe(lead.url)) : undefined;
        const discoveredFrom = entry ? [...entry.feeds] : lead.metadata?.discoveredFrom;
        const hackathon = leadLooksHackathon(lead);
        const feedTheme = isLumaFeedThemeCandidate(
          discoveredFrom,
          input.preferences.themes,
          input.preferences.rawCommand,
        );
        const contentTheme = leadContentMatchesTheme(lead, input.preferences.themes);
        if (hackathon) classifiedHackathon += 1;
        if (feedTheme) feedThemeCandidate += 1;
        if (contentTheme) contentThemeMatched += 1;
        if (hackathon && contentTheme) queryRelevantEstimate += 1;
        classifiedFlags.set(lead.id, { hackathon, feedTheme, contentTheme });
      }
      // themeRelevant ≡ contentThemeMatched (never feed provenance alone).
      const themeRelevant = contentThemeMatched;
      result.warnings.push(`classified_hackathon=${classifiedHackathon}`);
      result.warnings.push(`feed_theme_candidate=${feedThemeCandidate}`);
      result.warnings.push(`content_theme_matched=${contentThemeMatched}`);
      result.warnings.push(`theme_relevant=${themeRelevant}`);
      result.warnings.push(`query_relevant_estimate=${queryRelevantEstimate}`);
      result.warnings.push(`collected_raw_unique=${byUrl.size}`);
      input.logger?.(
        `Classification complete: ${byUrl.size} unique events → ${classifiedHackathon} hackathon-classified, ${feedThemeCandidate} feed-theme candidates, ${contentThemeMatched} content-theme matches (query-relevant estimate ${queryRelevantEstimate})`,
      );

      // Phase 3: detail enrichment only for promising records after classification.
      // Preserve prior enrich volume: no requested themes → enrich all (legacy);
      // with themes → hackathon OR content match OR feed-theme candidate (not text provenance).
      const enrichable = provisionalLeads.filter((lead) => {
        const flags = classifiedFlags.get(lead.id);
        if (!flags) return false;
        if (flags.hackathon || flags.contentTheme || flags.feedTheme) return true;
        return input.preferences.themes.length === 0;
      });
      const skippedDetail = provisionalLeads.length - enrichable.length;
      if (skippedDetail > 0) {
        result.warnings.push(`detail_skipped_unrelated=${skippedDetail}`);
        input.logger?.(
          `Skipping detail enrichment for ${skippedDetail} non-promising listing cards`,
        );
      }

      let detailPagesOpened = 0;
      let detailFailures = 0;
      if (enrichable.length > 0) {
        const detailTargetCount = enrichable
          .filter((lead) => !lumaListingDataIsSufficient(lead))
          .slice(0, budget.detailLimit).length;
        input.logger?.(
          detailTargetCount > 0
            ? `Opening up to ${detailTargetCount} Luma detail pages for weak listing records...`
            : "Skipping Luma detail pages because listing records are sufficient...",
        );
        const enriched = await enrichEventPages(
          enrichable,
          budgetMs,
          startedAt,
          budget.detailLimit,
          (lead) => !lumaListingDataIsSufficient(lead),
        );
        const byId = new Map(enriched.leads.map((lead) => [lead.id, lead]));
        result.leads = provisionalLeads
          .map((lead) => byId.get(lead.id) ?? lead)
          .slice(0, budget.maxEvents);
        result.warnings.push(...enriched.warnings);
        detailPagesOpened = enriched.opened;
        detailFailures = enriched.failures;
      } else {
        result.leads = provisionalLeads.slice(0, budget.maxEvents);
      }

      for (const lead of result.leads) {
        const url = lead.url;
        if (!url) continue;
        const entry = byUrl.get(normalizeUrlForDedupe(url));
        const flags = classifiedFlags.get(lead.id);
        const discoveredFrom = entry ? [...entry.feeds] : undefined;
        lead.metadata = {
          ...lead.metadata,
          ...(discoveredFrom
            ? {
                discoveryMode: discoveredFrom[0] ?? lead.metadata?.discoveryMode,
                discoveredFrom,
              }
            : {}),
          classifiedHackathon: flags?.hackathon ?? false,
          feedThemeCandidate: flags?.feedTheme ?? false,
          contentThemeMatched: flags?.contentTheme ?? false,
          // themeRelevant kept as content-theme alias for downstream readers.
          themeRelevant: flags?.contentTheme ?? false,
        };
      }

      result.metrics = {
        pagesFetched,
        leadsEmitted: result.leads.length,
        discoveryUrls: feeds.length,
        uniqueCards: byUrl.size,
        feedCardsSeen: uniqueCards,
        scrollAttempts,
        noGrowthAttempts,
        detailPagesOpened,
        detailFailures,
        maxEvents: budget.maxEvents,
        maxScrolls: budget.maxScrolls,
        detailLimit: budget.detailLimit,
        targetForProfile: budget.targetEvents,
        targetReached: byUrl.size >= budget.targetEvents ? 1 : 0,
        mode: mode === "authenticated" ? 1 : 0,
        classifiedHackathon,
        feedThemeCandidate,
        contentThemeMatched,
        themeRelevant,
        queryRelevant: queryRelevantEstimate,
      };
      result.warnings.push(`stop_reasons=${stopReasons.join(",")}`);
      result.warnings.push(`unique_cards=${byUrl.size}`);
      result.warnings.push(`scrolls=${scrollAttempts}`);
      result.warnings.push(`no_growth_attempts=${noGrowthAttempts}`);
      result.warnings.push(`details_opened=${detailPagesOpened}`);
      result.warnings.push(`detail_failures=${detailFailures}`);
      result.warnings.push(`profile_budget_events=${budget.maxEvents}`);
      result.warnings.push(`profile_budget_scrolls=${budget.maxScrolls}`);
      result.warnings.push(`profile_budget_detail_limit=${budget.detailLimit}`);
      result.warnings.push(`target_for_profile=${budget.targetEvents}`);
      result.warnings.push(
        `target_reached=${byUrl.size >= budget.targetEvents ? "true" : "false"}`,
      );
      result.warnings.push(`acquisition_scope=multi_feed_public_events`);
      result.status =
        result.errors.length > 0
          ? "failed"
          : result.leads.length === 0 && byUrl.size > 0
            ? "degraded"
            : "completed";
      result.diagnostics = {
        discovered: byUrl.size,
        returned: result.leads.length,
        enriched: Math.max(0, detailPagesOpened - detailFailures),
        partial: detailFailures,
        dropped: Math.max(0, byUrl.size - result.leads.length),
        stopReason: stopReasons.join(","),
        safeMessage:
          result.leads.length === 0 && byUrl.size > 0
            ? "Luma discovered public event URLs but returned no leads."
            : undefined,
      };

      if (result.leads.length === 0) {
        const hadParserIssue = result.warnings.some((w) =>
          /selector\/parser|did not fully render/i.test(w),
        );
        result.warnings.push(
          describeLumaFailure(hadParserIssue ? "selector_parser_failure" : "zero_matching_results"),
        );
        input.logger?.("Public discovery completed with 0 matching events");
      } else {
        input.logger?.(`${result.leads.length} leads found`);
      }
    } catch (error) {
      result.errors.push(
        describeLumaFailure(
          "network",
          error instanceof Error ? error.message : "Luma collection failed",
        ),
      );
    }

    // Keep legacy host mention for operators who still use lu.ma bookmarks.
    void LUMA_LEGACY_BASE;

    result.durationMs = Date.now() - startedAt;
    return result;
  },
};
