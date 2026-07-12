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
import { fetchHtml, FetchHtmlError } from "@/lib/http/fetchHtml";
import {
  formatPlaywrightInstallHint,
  isPlaywrightBrowserMissingError,
  withPlaywright,
} from "@/lib/browser/playwright";
import { normalizeUrl, normalizeUrlForDedupe, slugify, uniqueUrls } from "@/lib/http/url";

const DEVPOST_BASE = "https://devpost.com";
const MAX_SEARCH_URLS = 5;

export type DevpostFailureHint =
  | "network"
  | "anti_bot"
  | "rate_limit"
  | "browser_missing"
  | "selector_parser_failure"
  | "zero_matching_results"
  | "no_current_events";

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
    case "selector_parser_failure":
      return `Devpost selector/parser failure: UI may have changed${detail ? ` (${detail})` : ""}`;
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
  const urls: string[] = [];

  const push = (extra: Record<string, string | string[]>) => {
    const params = new URLSearchParams();
    params.append("status[]", "upcoming");
    params.append("challenge_type[]", "online");
    params.append("challenge_type[]", "in-person");
    for (const [key, value] of Object.entries(extra)) {
      if (Array.isArray(value)) {
        for (const item of value) params.append(key, item);
      } else {
        params.set(key, value);
      }
    }
    urls.push(`${DEVPOST_BASE}/hackathons?${params.toString()}`);
  };

  // Baseline upcoming listing
  push({});

  const themeTerms = preferences.themes
    .filter((t) => !/^(canada|remote|online)$/i.test(t))
    .slice(0, 2);
  for (const theme of themeTerms) {
    push({ search: theme });
  }
  if (!themeTerms.some((t) => /ai/i.test(t))) {
    push({ search: "AI" });
  }

  const locationTerms = preferences.locations
    .filter((l) => !/^(remote|online)$/i.test(l))
    .slice(0, 2);
  for (const location of locationTerms) {
    push({ search: location });
  }
  if (!locationTerms.some((l) => /toronto/i.test(l))) {
    push({ search: "Toronto" });
  }
  if (!locationTerms.some((l) => /canada/i.test(l))) {
    push({ search: "Canada" });
  }

  if (preferences.includeRemote) {
    push({ search: "remote", "challenge_type[]": ["online"] });
  } else {
    push({ search: "remote" });
  }

  return [...new Set(urls)].slice(0, MAX_SEARCH_URLS);
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
        provenance: "devpost_listing",
        sourceAuthority: "devpost",
        sourceIds: { devpost: slugify(card.title) },
      },
    });

    if (leads.length >= maxResults) break;
  }

  return leads;
}

async function fetchDevpostWithPlaywright(
  url: string,
  timeoutMs: number,
): Promise<{ html: string; warnings: string[] }> {
  const warnings: string[] = [];

  const html = await withPlaywright(async ({ page }) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page
      .locator("a.tile-anchor, a.block-wrapper-link, a[href*='.devpost.com/']")
      .first()
      .waitFor({ state: "attached", timeout: Math.min(timeoutMs, 12_000) })
      .catch(() => {
        warnings.push(
          "Devpost listing content did not fully render within timeout (Playwright public page).",
        );
      });
    return page.content();
  }, { timeoutMs });

  return { html, warnings };
}

function countDevpostTiles(html: string): number {
  const $ = cheerio.load(html);
  return $("a.tile-anchor, a.block-wrapper-link, a.challenge-listing").length;
}

export const devpostCollector: Collector = {
  source: "devpost",

  async collect(input: CollectorInput): Promise<CollectorResult> {
    const startedAt = Date.now();
    const result = emptyCollectorResult("devpost", startedAt);
    const searchUrls = buildDevpostSearchUrls(input.preferences);
    const seen = new Set<string>();
    let pagesFetched = 0;
    let usedPlaywright = 0;
    let staticEmpty = 0;

    result.warnings.push(
      "Devpost uses Playwright for public hackathon listings because static HTML omits challenge tiles.",
    );

    try {
      for (const searchUrl of searchUrls) {
        if (Date.now() - startedAt > input.timeoutMs) {
          result.warnings.push("Devpost collector stopped early after timeout budget.");
          break;
        }
        if (result.leads.length >= input.maxResults) break;

        const remaining = Math.max(2_000, input.timeoutMs - (Date.now() - startedAt));
        let html = "";

        try {
          html = await fetchHtml(searchUrl, { timeoutMs: Math.min(remaining, 8_000), retries: 1 });
          pagesFetched += 1;
        } catch (error) {
          if (error instanceof FetchHtmlError && (error.status === 403 || error.status === 503)) {
            result.warnings.push(describeDevpostFailure("anti_bot", error.message));
          } else if (error instanceof FetchHtmlError && error.status === 429) {
            result.warnings.push(describeDevpostFailure("rate_limit", error.message));
          } else {
            result.warnings.push(
              describeDevpostFailure(
                "network",
                error instanceof Error ? error.message : "static fetch failed",
              ),
            );
          }
        }

        let pageLeads = html ? parseDevpostHtml(html, input.maxResults) : [];
        if (pageLeads.length === 0) {
          staticEmpty += 1;
          try {
            const rendered = await fetchDevpostWithPlaywright(searchUrl, remaining);
            usedPlaywright += 1;
            pagesFetched += 1;
            html = rendered.html;
            result.warnings.push(...rendered.warnings);
            pageLeads = parseDevpostHtml(html, input.maxResults - result.leads.length);
          } catch (error) {
            if (isPlaywrightBrowserMissingError(error)) {
              result.errors.push(describeDevpostFailure("browser_missing"));
              break;
            }
            result.warnings.push(
              error instanceof Error ? error.message : "Devpost Playwright fallback failed",
            );
          }
        }

        if (html && pageLeads.length === 0 && countDevpostTiles(html) === 0) {
          // Keep going across queries; record once at end if still empty.
        }

        for (const lead of pageLeads) {
          const key = lead.url ? normalizeUrlForDedupe(lead.url) : lead.id;
          if (seen.has(key)) continue;
          seen.add(key);
          result.leads.push(lead);
          if (result.leads.length >= input.maxResults) break;
        }
      }

      result.metrics = {
        pagesFetched,
        playwrightPages: usedPlaywright,
        staticEmptyPages: staticEmpty,
        leadsEmitted: result.leads.length,
        searchUrls: searchUrls.length,
      };

      if (result.leads.length === 0 && result.errors.length === 0) {
        if (usedPlaywright > 0) {
          result.warnings.push(
            describeDevpostFailure(
              "selector_parser_failure",
              "Playwright rendered pages but no challenge tiles parsed",
            ),
          );
        } else {
          result.warnings.push(describeDevpostFailure("zero_matching_results"));
        }
      }
    } catch (error) {
      result.errors.push(
        describeDevpostFailure(
          "network",
          error instanceof Error ? error.message : "Devpost fetch failed",
        ),
      );
    }

    result.durationMs = Date.now() - startedAt;
    return result;
  },
};
