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
import { normalizeUrl, normalizeUrlForDedupe, slugify, uniqueUrls } from "@/lib/http/url";

const DEVPOST_BASE = "https://devpost.com";
export const DEVPOST_OPEN_UPCOMING_URL =
  "https://devpost.com/hackathons?status[]=upcoming&status[]=open";
const DEVPOST_MAX_SCROLLS = 12;
const DEVPOST_MAX_CARDS = 200;
const DEVPOST_SCROLL_WAIT_MS = 1_200;

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
  timeoutMs: number,
  logger?: (message: string) => void,
): Promise<DevpostRenderedListing> {
  const warnings: string[] = [];
  const startedAt = Date.now();

  return withPlaywright(async ({ page }) => {
    logger?.("Opening filtered listings...");
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
    if (!finalUrl.includes("/hackathons") || !finalUrl.includes("status")) {
      warnings.push(describeDevpostFailure("redirected", finalUrl));
    }

    await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 12_000) }).catch(() => {
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
    logger?.("Initial listing batch loaded");
    logger?.(`${initialCardCount} event cards found`);

    let finalCardCount = initialCardCount;
    let scrollAttempts = 0;
    let noGrowthAttempts = 0;
    let stopReason: DevpostLazyLoadStopReason = "no_additional_cards";

    while (scrollAttempts < DEVPOST_MAX_SCROLLS && finalCardCount < DEVPOST_MAX_CARDS) {
      if (Date.now() - startedAt > timeoutMs) {
        stopReason = "timeout";
        warnings.push(describeDevpostFailure("lazy_loading_timeout"));
        break;
      }

      scrollAttempts += 1;
      logger?.("Loading more listings...");
      const before = finalCardCount;
      await page.mouse.wheel(0, 2600).catch(() => undefined);
      await page.waitForTimeout(DEVPOST_SCROLL_WAIT_MS);
      await page.waitForLoadState("networkidle", { timeout: DEVPOST_SCROLL_WAIT_MS }).catch(() => undefined);
      finalCardCount = await uniqueCardCount().catch(() => before);

      if (finalCardCount > before) {
        noGrowthAttempts = 0;
        logger?.(`${finalCardCount} event cards found`);
      } else {
        noGrowthAttempts += 1;
      }

      const endMarker =
        (await page
          .locator("text=/end of results|no more hackathons|no additional/i")
          .count()
          .catch(() => 0)) > 0;
      if (endMarker) {
        stopReason = "end_marker_reached";
        break;
      }
      if (noGrowthAttempts >= 3) {
        stopReason = "no_additional_cards";
        break;
      }
    }

    if (finalCardCount >= DEVPOST_MAX_CARDS) stopReason = "maximum_cards_reached";
    else if (scrollAttempts >= DEVPOST_MAX_SCROLLS && noGrowthAttempts < 3) {
      stopReason = "maximum_scrolls_reached";
    }

    logger?.("Lazy loading complete");

    return {
      html: await page.content(),
      warnings,
      initialCardCount,
      finalCardCount,
      scrollAttempts,
      noGrowthAttempts,
      stopReason,
      finalUrl: page.url(),
      listingContainerFound,
      emptyStateFound,
    };
  }, { timeoutMs });
}

function countDevpostTiles(html: string): number {
  const $ = cheerio.load(html);
  return $("a.tile-anchor, a.block-wrapper-link, a.challenge-listing").length;
}

function hasDevpostChallengePage(html: string): boolean {
  return /captcha|cloudflare|verify you are human|access denied|blocked/i.test(html);
}

export const devpostCollector: Collector = {
  source: "devpost",

  async collect(input: CollectorInput): Promise<CollectorResult> {
    const startedAt = Date.now();
    const result = emptyCollectorResult("devpost", startedAt);
    const searchUrls = buildDevpostSearchUrls(input.preferences);
    const seen = new Set<string>();

    result.warnings.push(
      "Devpost uses Playwright for public open/upcoming hackathon listings because static HTML may omit challenge tiles.",
    );

    try {
      const searchUrl = searchUrls[0] ?? DEVPOST_OPEN_UPCOMING_URL;
      const rendered = await collectRenderedDevpostListing(
        searchUrl,
        input.timeoutMs,
        input.logger,
      );
      result.warnings.push(...rendered.warnings);

      if (rendered.finalCardCount === 0 && hasDevpostChallengePage(rendered.html)) {
        result.errors.push(describeDevpostFailure("anti_bot"));
      }

      const pageLeads = parseDevpostHtml(rendered.html, input.maxResults);
      for (const lead of pageLeads) {
        const key = lead.url ? normalizeUrlForDedupe(lead.url) : lead.id;
        if (seen.has(key)) continue;
        seen.add(key);
        result.leads.push(lead);
        if (result.leads.length >= input.maxResults) break;
      }

      result.metrics = {
        pagesFetched: 1,
        playwrightPages: 1,
        initialCardCount: rendered.initialCardCount,
        finalCardCount: rendered.finalCardCount,
        scrollAttempts: rendered.scrollAttempts,
        noGrowthAttempts: rendered.noGrowthAttempts,
        leadsEmitted: result.leads.length,
        searchUrls: 1,
      };

      if (result.leads.length === 0 && result.errors.length === 0) {
        const visibleCards = countDevpostTiles(rendered.html);
        if (visibleCards > 0) {
          result.warnings.push(
            describeDevpostFailure(
              "selector_parser_failure",
              "Filtered listing page loaded, but no event cards matched the parser. The Devpost page structure may have changed.",
            ),
          );
          input.logger?.(
            "Filtered listing page loaded, but no event cards matched the parser. The Devpost page structure may have changed.",
          );
        } else if (rendered.emptyStateFound) {
          result.warnings.push(describeDevpostFailure("no_current_events"));
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

    result.durationMs = Date.now() - startedAt;
    return result;
  },
};
