import * as cheerio from "cheerio";
import type { DiscoveryPreferences, RawLead } from "@/core/discovery/types";
import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";
import { fetchHtml } from "@/lib/http/fetchHtml";
import {
  formatPlaywrightInstallHint,
  isPlaywrightBrowserMissingError,
  withPlaywright,
} from "@/lib/browser/playwright";
import { normalizeUrl, normalizeUrlForDedupe, slugify, uniqueUrls } from "@/lib/http/url";

const LUMA_BASE = "https://lu.ma";
const MAX_DISCOVERY_PAGES = 6;

const HACKATHON_HINT =
  /\b(hackathon|buildathon|codefest|hack\s*day|hack\s*night|coding\s*competition|builder\s*competition|48[\s-]?hour\s*build|24[\s-]?hour\s*hack)\b/i;

const MEETUP_HINT =
  /\b(meetup|coffee|networking|happy\s*hour|casual\s*hang|fireside|panel\s*discussion|book\s*club)\b/i;

type ParsedLumaEvent = {
  title: string;
  url?: string;
  organizer?: string;
  dateText?: string;
  startDate?: string;
  location?: string;
  mode?: string;
  description?: string;
  registration?: string;
  externalLinks: string[];
};

function isLikelyHackathon(title: string, description: string): boolean {
  const text = `${title} ${description}`;
  if (HACKATHON_HINT.test(text)) return true;
  if (MEETUP_HINT.test(text) && !HACKATHON_HINT.test(text)) return false;
  // Soft accept: builder competition language without explicit meetup markers
  return /\b(builders?|agents?|prize|registration\s+open)\b/i.test(text) &&
    /\b(hack|build|code)\b/i.test(text);
}

function parseMode(location: string, description: string): string | undefined {
  const text = `${location} ${description}`.toLowerCase();
  if (/online|remote|virtual|everywhere/i.test(text)) return "online";
  if (/hybrid/i.test(text)) return "hybrid";
  if (/in\s*person|on-?site|campus/i.test(text)) return "in-person";
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

function buildDiscoveryUrls(preferences: DiscoveryPreferences): string[] {
  const queries: string[] = ["hackathon"];
  for (const theme of preferences.themes.slice(0, 3)) {
    queries.push(`${theme} hackathon`);
  }
  for (const location of preferences.locations.slice(0, 3)) {
    if (/remote|online/i.test(location)) {
      queries.push("remote hackathon");
    } else {
      queries.push(`${location} hackathon`);
    }
  }
  if (preferences.includeRemote) queries.push("online hackathon");

  const unique = [...new Set(queries.map((q) => q.trim().toLowerCase()).filter(Boolean))];
  const urls: string[] = [];

  for (const query of unique.slice(0, MAX_DISCOVERY_PAGES)) {
    // Public discover-style URLs; Luma may redirect or render client-side.
    urls.push(`${LUMA_BASE}/discover?q=${encodeURIComponent(query)}`);
  }

  // City calendar fallbacks when locations are present
  for (const location of preferences.locations.slice(0, 2)) {
    if (/toronto/i.test(location)) urls.push(`${LUMA_BASE}/toronto`);
    if (/waterloo/i.test(location)) urls.push(`${LUMA_BASE}/waterloo`);
  }

  return [...new Set(urls)].slice(0, MAX_DISCOVERY_PAGES);
}

function extractEventCards($: cheerio.CheerioAPI, baseUrl: string): ParsedLumaEvent[] {
  const cards: ParsedLumaEvent[] = [];
  const roots = $("article.event-card, article[data-testid='event'], .event-card, main article").toArray();

  for (const element of roots) {
    const root = $(element);
    const title =
      root.find("h1, h2, h3, .title, [data-testid='event-title']").first().text().trim() ||
      "";
    const href =
      root.find("a[href*='lu.ma/'], a[href*='luma.com/']").first().attr("href") ||
      root.find("a[href]").first().attr("href");
    const url = href ? normalizeUrl(href, baseUrl) : undefined;
    const organizer =
      root.find(".organizer, [data-testid='organizer'], .host").first().text().trim() || undefined;
    const timeEl = root.find("time").first();
    const dateText =
      timeEl.attr("datetime")?.trim() ||
      timeEl.text().trim() ||
      root.find(".date, .when").first().text().trim() ||
      undefined;
    const location =
      root.find(".location, .venue, [data-testid='location']").first().text().replace(/\s+/g, " ").trim() ||
      undefined;
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
    });
  }

  // Fallback: lone event page with og tags
  if (cards.length === 0) {
    const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
    const ogUrl = $('meta[property="og:url"]').attr("content")?.trim();
    const ogDesc = $('meta[property="og:description"]').attr("content")?.trim();
    if (ogTitle || ogUrl) {
      cards.push({
        title: ogTitle || "Luma event",
        url: ogUrl ? normalizeUrl(ogUrl, baseUrl) : undefined,
        description: ogDesc,
        externalLinks: [],
        mode: parseMode("", ogDesc ?? ""),
        startDate: undefined,
      });
    }
  }

  return cards;
}

export function parseLumaHtml(html: string, maxResults: number, baseUrl = LUMA_BASE): RawLead[] {
  const $ = cheerio.load(html);
  const cards = extractEventCards($, baseUrl);
  const leads: RawLead[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    if (!isLikelyHackathon(card.title, card.description ?? "")) continue;

    const dedupeKey = card.url ? normalizeUrlForDedupe(card.url) : slugify(card.title);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const applyUrl = card.externalLinks[0];
    const links = uniqueUrls(
      [card.url, applyUrl, ...card.externalLinks].filter(Boolean) as string[],
      baseUrl,
    );

    leads.push({
      id: `luma-${slugify(card.url ? new URL(card.url).pathname : card.title)}`,
      source: "luma",
      title: card.title,
      url: card.url,
      text: [card.organizer, card.dateText, card.location, card.description, card.registration]
        .filter(Boolean)
        .join(" — "),
      links,
      postedAt: new Date().toISOString(),
      metadata: {
        organizer: card.organizer,
        dateText: card.dateText,
        startDate: card.startDate,
        location: card.mode === "online" ? "Online" : card.location,
        mode: card.mode,
        registration: card.registration,
        officialUrl: applyUrl ?? card.url,
        applyUrl,
        sourceIds: {
          luma: card.url ? slugify(new URL(card.url).pathname) : slugify(card.title),
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
): Promise<{ html: string; warnings: string[] }> {
  const warnings: string[] = [];
  try {
    const html = await fetchHtml(url, { timeoutMs, retries: 1 });
    return { html, warnings };
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : `Failed to fetch ${url}`);
    try {
      const html = await withPlaywright(
        async ({ page }) => {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
          await page
            .locator("article, h1, [data-testid='event']")
            .first()
            .waitFor({ state: "attached", timeout: Math.min(timeoutMs, 6_000) })
            .catch(() => {
              warnings.push("Luma page content did not fully render within timeout.");
            });
          return page.content();
        },
        { timeoutMs },
      );
      return { html, warnings };
    } catch (playwrightError) {
      if (isPlaywrightBrowserMissingError(playwrightError)) {
        warnings.push(formatPlaywrightInstallHint());
      } else {
        warnings.push(
          playwrightError instanceof Error
            ? playwrightError.message
            : "Luma Playwright fallback failed",
        );
      }
      return { html: "", warnings };
    }
  }
}

export const lumaCollector: Collector = {
  source: "luma",

  async collect(input: CollectorInput): Promise<CollectorResult> {
    const startedAt = Date.now();
    const result = emptyCollectorResult("luma", startedAt);
    const discoveryUrls = buildDiscoveryUrls(input.preferences);
    const seen = new Set<string>();
    const budgetMs = input.timeoutMs;

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

        if (!page.html) continue;

        const pageLeads = parseLumaHtml(
          page.html,
          input.maxResults - result.leads.length,
          url,
        );
        for (const lead of pageLeads) {
          const key = lead.url ? normalizeUrlForDedupe(lead.url) : lead.id;
          if (seen.has(key)) continue;
          seen.add(key);
          result.leads.push(lead);
          if (result.leads.length >= input.maxResults) break;
        }
      }

      if (result.leads.length === 0) {
        result.warnings.push(
          "Luma returned no likely hackathon events from targeted public discovery pages.",
        );
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : "Luma collection failed");
    }

    result.durationMs = Date.now() - startedAt;
    return result;
  },
};
