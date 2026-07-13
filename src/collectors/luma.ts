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
import type { DiscoveryPreferences, RawLead } from "@/core/discovery/types";
import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";
import { fetchHtml, FetchHtmlError } from "@/lib/http/fetchHtml";
import {
  formatPlaywrightInstallHint,
  isPlaywrightBrowserMissingError,
  withPlaywright,
} from "@/lib/browser/playwright";
import { normalizeUrl, normalizeUrlForDedupe, slugify, uniqueUrls } from "@/lib/http/url";

const LUMA_BASE = "https://luma.com";
const LUMA_LEGACY_BASE = "https://lu.ma";
const MAX_DISCOVERY_PAGES = 6;
const MAX_EVENT_ENRICH = 4;

const HACKATHON_HINT =
  /\b(hackathon|buildathon|codefest|hack\s*day|hack\s*night|coding\s*competition|builder\s*competition|48[\s-]?hour\s*build|24[\s-]?hour\s*hack)\b/i;

const MEETUP_HINT =
  /\b(meetup|coffee|networking|happy\s*hour|casual\s*hang|fireside|panel\s*discussion|book\s*club|walkie|potluck|drink\s*&\s*draw)\b/i;

export type LumaDiscoveryMode = "public" | "authenticated";

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

function buildDiscoveryUrls(preferences: DiscoveryPreferences): string[] {
  const urls: string[] = [];

  // Prefer city hubs — they embed individual events in __NEXT_DATA__.
  const cityMap: Record<string, string> = {
    toronto: `${LUMA_BASE}/toronto`,
    waterloo: `${LUMA_BASE}/waterloo`,
    montreal: `${LUMA_BASE}/montreal`,
    "san francisco": `${LUMA_BASE}/sf`,
    sf: `${LUMA_BASE}/sf`,
    nyc: `${LUMA_BASE}/nyc`,
    "new york": `${LUMA_BASE}/nyc`,
  };

  for (const location of preferences.locations.slice(0, 4)) {
    const key = location.trim().toLowerCase();
    if (cityMap[key]) urls.push(cityMap[key]);
    else if (!/remote|online|canada/i.test(key)) {
      urls.push(`${LUMA_BASE}/${slugify(location)}`);
    }
  }

  // Default Canadian hubs when locations are empty or Canada-only.
  if (urls.length === 0 || preferences.locations.some((l) => /canada/i.test(l))) {
    urls.push(`${LUMA_BASE}/toronto`, `${LUMA_BASE}/waterloo`);
  }

  // Discover search is noisy (often places, not events) but may still embed featured events.
  urls.push(`${LUMA_BASE}/discover?q=${encodeURIComponent("hackathon")}`);
  for (const theme of preferences.themes.slice(0, 2)) {
    urls.push(`${LUMA_BASE}/discover?q=${encodeURIComponent(`${theme} hackathon`)}`);
  }
  if (preferences.includeRemote) {
    urls.push(`${LUMA_BASE}/discover?q=${encodeURIComponent("online hackathon")}`);
  }

  return [...new Set(urls)].slice(0, MAX_DISCOVERY_PAGES);
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

export function parseLumaHtml(html: string, maxResults: number, baseUrl = LUMA_BASE): RawLead[] {
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
    if (!isLikelyHackathon(card.title, card.description ?? "")) continue;
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
        .join(" — "),
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

async function enrichEventPages(
  leads: RawLead[],
  timeoutMs: number,
  startedAt: number,
): Promise<{ leads: RawLead[]; warnings: string[] }> {
  const warnings: string[] = [];
  const enriched: RawLead[] = [];

  for (const lead of leads) {
    if (enriched.length >= leads.length) break;
    if (!lead.url || Date.now() - startedAt > timeoutMs) {
      enriched.push(lead);
      continue;
    }
    if (enriched.filter((l) => l.metadata?.enriched).length >= MAX_EVENT_ENRICH) {
      enriched.push(lead);
      continue;
    }

    try {
      const remaining = Math.max(1_500, timeoutMs - (Date.now() - startedAt));
      const page = await fetchLumaPage(lead.url, remaining);
      warnings.push(...page.warnings);
      if (!page.html) {
        enriched.push(lead);
        continue;
      }
      const detailLeads = parseLumaHtml(page.html, 1, page.finalUrl || lead.url);
      const detail = detailLeads[0];
      if (!detail) {
        enriched.push(lead);
        continue;
      }
      enriched.push({
        ...lead,
        title: detail.title || lead.title,
        text: detail.text || lead.text,
        links: uniqueUrls([...lead.links, ...detail.links], LUMA_BASE),
        metadata: {
          ...lead.metadata,
          ...detail.metadata,
          enriched: true,
        },
      });
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "Luma enrich failed");
      enriched.push(lead);
    }
  }

  return { leads: enriched, warnings };
}

export const lumaCollector: Collector = {
  source: "luma",

  async collect(input: CollectorInput): Promise<CollectorResult> {
    const startedAt = Date.now();
    const result = emptyCollectorResult("luma", startedAt);
    const mode = resolveLumaDiscoveryMode();
    const discoveryUrls = buildDiscoveryUrls(input.preferences);
    const seen = new Set<string>();
    const budgetMs = input.timeoutMs;
    let pagesFetched = 0;

    result.warnings.push(`luma_mode=${mode}`);

    if (mode === "authenticated") {
      // Stub: same persistent-browser architecture as Hakku would apply, but optional.
      result.warnings.push(
        "Luma connected mode is unavailable (optional persistent-browser auth not implemented); continuing with public discovery only.",
      );
    }
    input.logger?.("Starting public discovery...");

    try {
      for (const url of discoveryUrls) {
        if (Date.now() - startedAt > budgetMs) {
          result.warnings.push("Luma collector stopped early after timeout budget.");
          break;
        }
        if (result.leads.length >= input.maxResults) break;

        const remaining = Math.max(1_000, budgetMs - (Date.now() - startedAt));
        const page = await fetchLumaPage(url, remaining);
        result.warnings.push(...page.warnings);
        pagesFetched += page.html ? 1 : 0;
        if (!page.html) continue;

        const pageLeads = parseLumaHtml(
          page.html,
          input.maxResults - result.leads.length,
          page.finalUrl || url,
        );

        for (const lead of pageLeads) {
          const key = lead.url ? normalizeUrlForDedupe(lead.url) : lead.id;
          if (seen.has(key)) continue;
          seen.add(key);
          result.leads.push(lead);
          if (result.leads.length >= input.maxResults) break;
        }
      }

      if (result.leads.length > 0) {
        const enriched = await enrichEventPages(result.leads, budgetMs, startedAt);
        result.leads = enriched.leads.slice(0, input.maxResults);
        result.warnings.push(...enriched.warnings);
      }

      result.metrics = {
        pagesFetched,
        leadsEmitted: result.leads.length,
        discoveryUrls: discoveryUrls.length,
        mode: mode === "authenticated" ? 1 : 0,
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
