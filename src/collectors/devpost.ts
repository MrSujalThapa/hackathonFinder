/**
 * Devpost native hackathon collector.
 *
 * Why Playwright: `GET https://devpost.com/hackathons` returns a marketing shell
 * without challenge tiles. Public listing cards (`a.tile-anchor`) are client-rendered.
 * Playwright is used only for that public listing page — never for account login.
 */
import * as cheerio from "cheerio";
import type { DiscoveryPreferences, RawLead } from "@/core/discovery/types";
import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";
import {
  formatPlaywrightInstallHint,
  isPlaywrightBrowserMissingError,
  withPlaywright,
} from "@/lib/browser/playwright";
import { collectUntilStable } from "@/lib/browser/collectUntilStable";
import { normalizeUrl, normalizeUrlForDedupe, slugify, uniqueUrls } from "@/lib/http/url";

const DEVPOST_BASE = "https://devpost.com";
const DEVPOST_MAX_EVENTS = 100;
const DEVPOST_MAX_PAGES = 20;
const DEVPOST_MAX_SCROLLS_PER_PAGE = 6;
const DEVPOST_SCROLL_NO_GROWTH_LIMIT = 2;
const DEVPOST_SCROLL_WAIT_MS = 800;
const DEVPOST_PAGE_TIMEOUT_MS = 12_000;
const DEVPOST_PAGE_CONCURRENCY = 3;
export function buildDevpostListingsUrl(page: number): string {
  const pageNumber = Math.max(1, Math.floor(page));
  return `${DEVPOST_BASE}/hackathons?status[]=upcoming&status[]=open&page=${pageNumber}`;
}
export const DEVPOST_OPEN_UPCOMING_URL = buildDevpostListingsUrl(1);
export function buildDevpostApiUrl(page: number): string {
  const pageNumber = Math.max(1, Math.floor(page));
  return `${DEVPOST_BASE}/api/hackathons?status[]=upcoming&status[]=open&page=${pageNumber}`;
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
): RawLead[] {
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
    if (isEndedStatus(status, text)) continue;

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
        location,
        status,
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
        sourceAuthority: "devpost",
        sourceIds: { devpost: item.id ?? slugify(title) },
      },
    });
  }
  return leads;
}

async function fetchDevpostApiPage(
  pageNumber: number,
  maxResults: number,
  timeoutMs: number,
): Promise<DevpostApiPageResult> {
  const requestedUrl = buildDevpostApiUrl(pageNumber);
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
    const leads = parseDevpostApiPayload(payload, maxResults);
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
    logger?.(`Opening filtered listings page ${pageNumber}...`);
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
      const parsed = new URL(finalUrl);
      const statuses = parsed.searchParams.getAll("status[]");
      redirected =
        redirected ||
        !statuses.includes("upcoming") ||
        !statuses.includes("open") ||
        parsed.searchParams.get("page") !== String(pageNumber);
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

async function collectDevpostApiPages(
  maxResults: number,
  timeoutMs: number,
  logger?: (message: string) => void,
): Promise<{
  leads: RawLead[];
  pages: DevpostApiPageResult[];
  duplicateUrls: number;
  repeatedPages: number;
  stopReason: string;
}> {
  const startedAt = Date.now();
  const pages: DevpostApiPageResult[] = [];
  const leads: RawLead[] = [];
  const seenUrls = new Set<string>();
  const seenFingerprints = new Map<string, number>();
  let duplicateUrls = 0;
  let repeatedPages = 0;
  let stopReason = "no_next_page";

  const mergePage = (page: DevpostApiPageResult) => {
    pages.push(page);
    if (page.fingerprint) {
      const prior = seenFingerprints.get(page.fingerprint);
      if (prior != null) {
        repeatedPages += 1;
        logger?.(`Page ${page.requestedPage} repeated page ${prior}`);
        page.status = "degraded";
        page.stopReason = "repeated_fingerprint";
      } else {
        seenFingerprints.set(page.fingerprint, page.requestedPage);
      }
    }

    let added = 0;
    let duplicateExisting = 0;
    for (const lead of page.leads) {
      if (leads.length >= maxResults) break;
      const key = lead.url ? normalizeUrlForDedupe(lead.url) : lead.id;
      if (seenUrls.has(key)) {
        duplicateUrls += 1;
        duplicateExisting += 1;
        continue;
      }
      seenUrls.add(key);
      leads.push(lead);
      added += 1;
    }
    const capped = Math.max(0, page.leads.length - added - duplicateExisting);
    logger?.(
      `Page ${page.requestedPage}: ${page.cardCount} cards - ${added} new${duplicateExisting ? ` - ${duplicateExisting} duplicate` : ""}${capped ? ` - ${capped} capped` : ""}`,
    );
    logger?.(
      `Page ${page.requestedPage} URL: requested ${page.requestedUrl}; final ${page.finalUrl}`,
    );
    if (page.firstUrls.length > 0) {
      logger?.(
        `Page ${page.requestedPage} fingerprint: first ${page.firstUrls[0]} last ${page.lastUrls.at(-1)}`,
      );
    }
  };

  logger?.("Fetching native API page 1...");
  const first = await fetchDevpostApiPage(
    1,
    maxResults,
    Math.min(timeoutMs, DEVPOST_PAGE_TIMEOUT_MS),
  );
  mergePage(first);
  if (first.status === "failed") {
    return { leads, pages, duplicateUrls, repeatedPages, stopReason: "api_page_failed" };
  }

  let nextPage = first.nextPage;
  while (nextPage && leads.length < maxResults && nextPage <= DEVPOST_MAX_PAGES) {
    if (Date.now() - startedAt > timeoutMs) {
      stopReason = "timeout";
      break;
    }
    const batchPages = Array.from(
      { length: Math.min(DEVPOST_PAGE_CONCURRENCY, DEVPOST_MAX_PAGES - nextPage + 1) },
      (_value, index) => nextPage! + index,
    );
    logger?.(`Fetching pages ${batchPages[0]}-${batchPages.at(-1)} concurrently`);
    const remaining = Math.max(1_000, timeoutMs - (Date.now() - startedAt));
    const batch = await Promise.allSettled(
      batchPages.map((pageNumber) =>
        fetchDevpostApiPage(
          pageNumber,
          maxResults,
          Math.min(remaining, DEVPOST_PAGE_TIMEOUT_MS),
        ),
      ),
    );
    const results = batch
      .map((item, index): DevpostApiPageResult => {
        if (item.status === "fulfilled") return item.value;
        const pageNumber = batchPages[index]!;
        return {
          requestedPage: pageNumber,
          requestedUrl: buildDevpostApiUrl(pageNumber),
          finalUrl: buildDevpostApiUrl(pageNumber),
          activePage: pageNumber,
          leads: [],
          cardCount: 0,
          fingerprint: "",
          firstUrls: [],
          lastUrls: [],
          hasNext: false,
          status: "failed",
          stopReason: "api_error",
          error: item.reason instanceof Error ? item.reason.message : "Devpost API page failed",
        };
      })
      .sort((a, b) => a.requestedPage - b.requestedPage);

    let batchHadNext = false;
    let batchAdded = 0;
    for (const page of results) {
      const before = leads.length;
      mergePage(page);
      batchAdded += leads.length - before;
      if (page.hasNext) batchHadNext = true;
      if (leads.length >= maxResults) {
        stopReason = "maximum_cards_reached";
        break;
      }
    }
    if (repeatedPages > 0) {
      stopReason = "repeated_fingerprint";
      break;
    }
    if (batchAdded === 0) {
      stopReason = "no_additional_cards";
      break;
    }
    if (!batchHadNext) {
      stopReason = "no_next_page";
      break;
    }
    nextPage = batchPages.at(-1)! + 1;
  }

  if (leads.length >= maxResults) stopReason = "maximum_cards_reached";
  if (nextPage && nextPage > DEVPOST_MAX_PAGES) stopReason = "maximum_pages_reached";
  return { leads, pages, duplicateUrls, repeatedPages, stopReason };
}

export const devpostCollector: Collector = {
  source: "devpost",

  async collect(input: CollectorInput): Promise<CollectorResult> {
    const startedAt = Date.now();
    const result = emptyCollectorResult("devpost", startedAt);
    const searchUrls = buildDevpostSearchUrls(input.preferences);
    const seen = new Set<string>();
    const maxAccepted = Math.min(input.maxResults, DEVPOST_MAX_EVENTS);
    let pagesFetched = 0;
    let initialCardCount = 0;
    let finalCardCount = 0;
    const scrollAttempts = 0;
    const noGrowthAttempts = 0;
    const pageNoGrowthAttempts = 0;
    let duplicateUrls = 0;
    let parserFailures = 0;
    let stopReason: DevpostLazyLoadStopReason | "maximum_pages_reached" = "no_additional_cards";

    result.warnings.push(
      "Devpost uses Playwright for public open/upcoming hackathon listings because static HTML may omit challenge tiles.",
    );

    try {
      void searchUrls;
      input.logger?.("Using observed read-only Devpost API pagination...");
      const api = await collectDevpostApiPages(maxAccepted, input.timeoutMs, input.logger);
      result.leads = api.leads;
      pagesFetched = api.pages.length;
      finalCardCount = api.pages.reduce((sum, page) => sum + page.cardCount, 0);
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

      result.metrics = {
        pagesFetched,
        playwrightPages: 0,
        initialCardCount,
        finalCardCount,
        scrollAttempts,
        noGrowthAttempts,
        pageNoGrowthAttempts,
        duplicateUrls,
        parserFailures,
        repeatedPages: api.repeatedPages,
        leadsEmitted: result.leads.length,
        searchUrls: pagesFetched,
      };
      result.warnings.push(`stop_reason=${stopReason}`);
      result.warnings.push(`unique_cards=${finalCardCount}`);
      result.warnings.push(`scrolls=${scrollAttempts}`);
      result.warnings.push(`no_growth_attempts=${noGrowthAttempts}`);
      result.warnings.push(`page_no_growth_attempts=${pageNoGrowthAttempts}`);
      result.warnings.push(`duplicates=${duplicateUrls}`);

      if (result.leads.length === 0 && result.errors.length === 0) {
        const searchUrl = searchUrls[0] ?? DEVPOST_OPEN_UPCOMING_URL;
        const remaining = Math.max(1_000, input.timeoutMs - (Date.now() - startedAt));
        const rendered = await collectRenderedDevpostListing(
          searchUrl,
          1,
          Math.min(remaining, DEVPOST_PAGE_TIMEOUT_MS),
          input.logger,
        );
        result.warnings.push(...rendered.warnings);
        finalCardCount = Math.max(finalCardCount, rendered.finalCardCount);
        const fallbackLeads = parseDevpostHtml(rendered.html, maxAccepted);
        for (const lead of fallbackLeads) {
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
      partial: parserFailures,
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
