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
import type { RawLead } from "@/core/discovery/types";
import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";
import { fetchHtml, FetchHtmlError } from "@/lib/http/fetchHtml";
import {
  formatPlaywrightInstallHint,
  isPlaywrightBrowserMissingError,
  withPlaywright,
} from "@/lib/browser/playwright";
import { collectUntilStable } from "@/lib/browser/collectUntilStable";
import { normalizeUrl, normalizeUrlForDedupe, slugify, uniqueUrls } from "@/lib/http/url";

const LUMA_BASE = "https://luma.com";
const LUMA_LEGACY_BASE = "https://lu.ma";
const LUMA_MAX_EVENTS = 100;
const LUMA_MAX_SCROLLS = 30;
const LUMA_NO_GROWTH_LIMIT = 3;
const LUMA_SCROLL_WAIT_MS = 1_200;
const LUMA_DETAIL_LIMIT = 30;
const DETAIL_PAGE_CONCURRENCY = 3;
const LUMA_DETAIL_TIMEOUT_MS = 8_000;

const HACKATHON_HINT =
  /\b(hackathon|buildathon|codefest|hack\s*day|hack\s*night|coding\s*competition|builder\s*competition|48[\s-]?hour\s*build|24[\s-]?hour\s*hack)\b/i;

const MEETUP_HINT =
  /\b(meetup|coffee|networking|happy\s*hour|casual\s*hang|fireside|panel\s*discussion|book\s*club|walkie|potluck|drink\s*&\s*draw)\b/i;

export type LumaDiscoveryMode = "public" | "authenticated";
export type LumaDiscoveryFeed =
  | "luma_toronto"
  | "luma_waterloo"
  | "luma_tech"
  | "luma_ai";

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

const TOPIC_FEEDS: LumaFeedConfig[] = [
  { mode: "luma_tech", label: "Tech", url: `${LUMA_BASE}/tech`, type: "topic" },
  { mode: "luma_ai", label: "AI", url: `${LUMA_BASE}/ai`, type: "topic" },
];

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

export function resolveLumaFeeds(input: {
  requestedLocation?: string;
  requestedTopics?: string[];
}): LumaFeedResolution {
  const feeds: LumaFeedConfig[] = [];
  const requestedLocation = input.requestedLocation?.trim();
  const key = requestedLocation?.toLowerCase();

  if (key === "ontario") {
    feeds.push(VERIFIED_LOCATION_FEEDS.toronto, VERIFIED_LOCATION_FEEDS.waterloo);
  } else if (key && VERIFIED_LOCATION_FEEDS[key]) {
    feeds.push(VERIFIED_LOCATION_FEEDS[key]);
  }

  feeds.push(...TOPIC_FEEDS);

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
  });
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
    if (!isUpcoming(card.dateText ?? card.startDate, card.endDate)) continue;

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
  return parseLumaHtml(html, LUMA_MAX_EVENTS, page.url(), discoveryMode)
    .map((lead) => lead.url)
    .filter((url): url is string => Boolean(url))
    .filter(isLikelyLumaEventUrl);
}

async function collectRenderedLumaFeed(
  feed: LumaFeedConfig,
  timeoutMs: number,
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

        const collected = await collectUntilStable<string>({
          collectItems: () => collectLumaEventUrlsFromPage(page, feed.mode),
          getKey: (url) => normalizeUrlForDedupe(url),
          scroll: async () => {
            await page.mouse.wheel(0, 2_400);
          },
          waitForIdle: async () => {
            await page
              .waitForLoadState("networkidle", { timeout: LUMA_SCROLL_WAIT_MS })
              .catch(() => undefined);
          },
          maxItems: LUMA_MAX_EVENTS,
          maxScrolls: LUMA_MAX_SCROLLS,
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
          urls: collected.items,
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
): Promise<{ leads: RawLead[]; warnings: string[]; opened: number; failures: number }> {
  const warnings: string[] = [];
  let opened = 0;
  let failures = 0;

  const enriched = await mapLimit(leads, DETAIL_PAGE_CONCURRENCY, async (lead, index) => {
    if (!lead.url || Date.now() - startedAt > timeoutMs || index >= LUMA_DETAIL_LIMIT) {
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

export const lumaCollector: Collector = {
  source: "luma",

  async collect(input: CollectorInput): Promise<CollectorResult> {
    const startedAt = Date.now();
    const result = emptyCollectorResult("luma", startedAt);
    const mode = resolveLumaDiscoveryMode();
    const feedResolution = buildDiscoveryFeeds(input);
    const feeds = feedResolution.feeds;
    const byUrl = new Map<string, { url: string; feeds: Set<LumaDiscoveryFeed> }>();
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
    input.logger?.(`Topic feeds: ${topicFeeds.map((feed) => feed.label).join(", ")}`);

    try {
      for (const feed of feeds) {
        if (Date.now() - startedAt > budgetMs) {
          result.warnings.push("Luma collector stopped early after timeout budget.");
          break;
        }
        const remaining = Math.max(1_000, budgetMs - (Date.now() - startedAt));
        const feedResult = await collectRenderedLumaFeed(feed, remaining, input.logger);
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
        .slice(0, Math.min(input.maxResults, LUMA_MAX_EVENTS))
        .map(({ url, feeds }) => {
          const discoveredFrom = [...feeds];
          const primaryFeed = discoveredFrom[0] ?? "luma_public";
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

      let detailPagesOpened = 0;
      let detailFailures = 0;
      if (provisionalLeads.length > 0) {
        input.logger?.(
          `Opening up to ${Math.min(provisionalLeads.length, LUMA_DETAIL_LIMIT)} Luma detail pages...`,
        );
        const enriched = await enrichEventPages(provisionalLeads, budgetMs, startedAt);
        result.leads = enriched.leads.slice(0, input.maxResults);
        result.warnings.push(...enriched.warnings);
        detailPagesOpened = enriched.opened;
        detailFailures = enriched.failures;
      }

      for (const lead of result.leads) {
        const url = lead.url;
        if (!url) continue;
        const entry = byUrl.get(normalizeUrlForDedupe(url));
        if (!entry) continue;
        const discoveredFrom = [...entry.feeds];
        lead.metadata = {
          ...lead.metadata,
          discoveryMode: discoveredFrom[0] ?? lead.metadata?.discoveryMode,
          discoveredFrom,
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
        mode: mode === "authenticated" ? 1 : 0,
      };
      result.warnings.push(`stop_reasons=${stopReasons.join(",")}`);
      result.warnings.push(`unique_cards=${byUrl.size}`);
      result.warnings.push(`scrolls=${scrollAttempts}`);
      result.warnings.push(`no_growth_attempts=${noGrowthAttempts}`);
      result.warnings.push(`details_opened=${detailPagesOpened}`);
      result.warnings.push(`detail_failures=${detailFailures}`);
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
