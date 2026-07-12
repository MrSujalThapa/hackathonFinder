import * as cheerio from "cheerio";
import type { RawLead } from "@/core/discovery/types";
import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";
import { fetchHtml, FetchHtmlError } from "@/lib/http/fetchHtml";
import {
  formatPlaywrightInstallHint,
  isPlaywrightBrowserMissingError,
  withPlaywright,
} from "@/lib/browser/playwright";
import { normalizeUrl, normalizeUrlForDedupe, slugify, uniqueUrls } from "@/lib/http/url";

const MLH_BASE = "https://www.mlh.com";
const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

type MlhInertiaEvent = {
  id?: string;
  slug?: string;
  name?: string;
  status?: string;
  startsAt?: string;
  endsAt?: string;
  dateRange?: string;
  url?: string;
  location?: string;
  formatType?: string;
  websiteUrl?: string;
  region?: string;
};

type ParsedMlhCard = {
  title: string;
  url?: string;
  dateText?: string;
  location?: string;
  mode?: string;
  description?: string;
  themes: string[];
  startDate?: string;
  endDate?: string;
  sourceId?: string;
  websiteUrl?: string;
};

export type ParseMlhHtmlOptions = {
  now?: Date;
  seasonYear?: number;
  baseUrl?: string;
};

export function buildMlhListingUrls(now = new Date()): string[] {
  const year = now.getUTCFullYear();
  // Academic seasons often roll forward mid-calendar-year (e.g. Jul 2026 → 2027 season).
  return [
    `${MLH_BASE}/events`,
    `${MLH_BASE}/seasons/${year + 1}/events`,
    `${MLH_BASE}/seasons/${year}/events`,
  ];
}

function extractSourceId(url: string | undefined, fallback?: string): string | undefined {
  if (fallback) return fallback;
  if (!url) return undefined;
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\/events\/([^/?#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : slugify(pathname);
  } catch {
    return undefined;
  }
}

function parseMode(notes: string, location: string): string | undefined {
  const text = `${notes} ${location}`.toLowerCase();
  if (/digital|online|remote|virtual|everywhere/i.test(text)) return "online";
  if (/hybrid/i.test(text)) return "hybrid";
  if (/physical|in-?person|on-?campus|in person only/i.test(text)) return "in-person";
  return undefined;
}

function parseThemes(text: string): string[] {
  const themes = new Set<string>();
  if (/\bai\b|artificial intelligence|machine learning/i.test(text)) themes.add("AI");
  if (/\bagents?\b/i.test(text)) themes.add("agents");
  if (/\bweb3\b|blockchain/i.test(text)) themes.add("web3");
  if (/\bcloud\b/i.test(text)) themes.add("cloud");
  return [...themes];
}

function toIsoDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month, day));
  return date.toISOString().slice(0, 10);
}

function parseMlhDateRange(
  dateText: string,
  seasonYear: number,
): { startDate?: string; endDate?: string } {
  const cleaned = dateText.replace(/(\d+)(st|nd|rd|th)/gi, "$1").trim();
  const rangeMatch = cleaned.match(
    /^([A-Za-z]+)\s+(\d{1,2})(?:\s*[-–—]\s*([A-Za-z]+)?\s*(\d{1,2}))?/i,
  );
  if (!rangeMatch) return {};

  const startMonthName = rangeMatch[1]?.toLowerCase() ?? "";
  const startDay = Number.parseInt(rangeMatch[2] ?? "", 10);
  const endMonthName = (rangeMatch[3] ?? rangeMatch[1] ?? "").toLowerCase();
  const endDay = Number.parseInt(rangeMatch[4] ?? rangeMatch[2] ?? "", 10);
  const startMonth = MONTHS[startMonthName];
  const endMonth = MONTHS[endMonthName];

  if (startMonth === undefined || Number.isNaN(startDay)) return {};

  const startYear = seasonYear;
  let endYear = seasonYear;
  if (endMonth !== undefined && endMonth < startMonth) {
    endYear = seasonYear + 1;
  }

  const startDate = toIsoDate(startYear, startMonth, startDay);
  const endDate =
    endMonth !== undefined && !Number.isNaN(endDay)
      ? toIsoDate(endYear, endMonth, endDay)
      : startDate;

  return { startDate, endDate };
}

function isClearlyPast(endDate: string | undefined, now: Date): boolean {
  if (!endDate) return false;
  const end = new Date(`${endDate}T23:59:59Z`);
  if (Number.isNaN(end.getTime())) return false;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return end.getTime() < today.getTime();
}

function isoDatePart(value?: string): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1];
}

function extractInertiaEvents(html: string): MlhInertiaEvent[] {
  const marker = 'data-page="app"';
  const idx = html.indexOf(marker);
  if (idx < 0) return [];
  const start = html.indexOf(">", idx) + 1;
  if (start <= 0) return [];
  const end = html.indexOf("</script>", start);
  if (end < 0) return [];

  try {
    const data = JSON.parse(html.slice(start, end)) as {
      props?: { upcomingEvents?: MlhInertiaEvent[]; pastEvents?: MlhInertiaEvent[] };
    };
    return data.props?.upcomingEvents ?? [];
  } catch {
    return [];
  }
}

function cardsFromInertia(
  events: MlhInertiaEvent[],
  now: Date,
  baseUrl: string,
): ParsedMlhCard[] {
  const cards: ParsedMlhCard[] = [];

  for (const event of events) {
    const title = event.name?.trim();
    if (!title) continue;

    const pathOrUrl = event.url ? event.url.replace(/\/prizes\/?$/i, "") : undefined;
    const url = pathOrUrl ? normalizeUrl(pathOrUrl, baseUrl) : undefined;
    const startDate = isoDatePart(event.startsAt);
    const endDate = isoDatePart(event.endsAt);
    if (isClearlyPast(endDate ?? startDate, now)) continue;
    if (event.status && /ended|cancelled|canceled/i.test(event.status)) continue;

    const location = event.location?.trim();
    const mode = parseMode(event.formatType ?? "", location ?? "");
    const websiteUrl = event.websiteUrl
      ? normalizeUrl(event.websiteUrl, baseUrl)
      : undefined;

    cards.push({
      title,
      url: websiteUrl ?? url,
      dateText: event.dateRange,
      location,
      mode,
      description: [event.region, event.dateRange, location].filter(Boolean).join(" — "),
      themes: parseThemes(title),
      startDate,
      endDate,
      sourceId: event.slug ?? event.id ?? extractSourceId(url),
      websiteUrl,
    });
  }

  return cards;
}

function cardsFromCheerio(
  html: string,
  now: Date,
  seasonYear: number,
  baseUrl: string,
): ParsedMlhCard[] {
  const $ = cheerio.load(html);
  const cards: ParsedMlhCard[] = [];
  const wrappers = $(".event-wrapper").toArray();
  const nodes = wrappers.length > 0 ? wrappers : $(".event, .event-card, article.event").toArray();

  for (const element of nodes) {
    const root = $(element);
    const link =
      root.find("a.event-link, a[href*='events.mlh'], a[href*='/events/']").first().attr("href") ??
      (root.is("a") ? root.attr("href") : undefined);
    const title =
      root.find(".event-name, h3, h2").first().text().trim() ||
      root.find("a.event-link").attr("title")?.trim() ||
      "";
    if (!title) continue;

    const dateText = root.find(".event-date, time, .date").first().text().trim() || undefined;
    const location =
      root.find(".event-location, .location").first().text().replace(/\s+/g, " ").trim() ||
      undefined;
    const hybridNotes = root.find(".event-hybrid-notes, .event-type, .hybrid").first().text().trim();
    const description =
      root.find(".event-description, .description, p").not(".event-date").first().text().trim() ||
      undefined;
    const url = link ? normalizeUrl(link, baseUrl) : undefined;
    const { startDate, endDate } = dateText
      ? parseMlhDateRange(dateText, seasonYear)
      : { startDate: undefined, endDate: undefined };

    if (isClearlyPast(endDate, now)) continue;

    cards.push({
      title,
      url,
      dateText,
      location,
      mode: parseMode(hybridNotes, location ?? ""),
      description,
      themes: parseThemes([title, description, hybridNotes].filter(Boolean).join(" ")),
      startDate,
      endDate,
      sourceId: extractSourceId(url) ?? slugify(title),
    });
  }

  return cards;
}

export function parseMlhHtml(
  html: string,
  maxResults: number,
  options: ParseMlhHtmlOptions = {},
): RawLead[] {
  const now = options.now ?? new Date();
  const seasonYear = options.seasonYear ?? now.getUTCFullYear();
  const baseUrl = options.baseUrl ?? MLH_BASE;

  const inertiaCards = cardsFromInertia(extractInertiaEvents(html), now, baseUrl);
  const cards =
    inertiaCards.length > 0
      ? inertiaCards
      : cardsFromCheerio(html, now, seasonYear, baseUrl);

  const leads: RawLead[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    const dedupeKey = card.url ? normalizeUrlForDedupe(card.url) : slugify(card.title);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const links = uniqueUrls(
      [card.url, card.websiteUrl].filter(Boolean) as string[],
      baseUrl,
    );
    const mode = card.mode;

    leads.push({
      id: `mlh-${card.sourceId ?? slugify(card.title)}`,
      source: "mlh",
      title: card.title,
      url: card.url,
      text: [card.dateText, card.location, card.mode, card.description].filter(Boolean).join(" — "),
      links,
      postedAt: new Date().toISOString(),
      metadata: {
        dateText: card.dateText,
        location: mode === "online" ? "Online" : card.location,
        mode,
        startDate: card.startDate,
        endDate: card.endDate,
        themes: card.themes,
        officialUrl: card.websiteUrl ?? card.url,
        applyUrl: card.websiteUrl,
        sourceIds: { mlh: card.sourceId ?? slugify(card.title) },
      },
    });

    if (leads.length >= maxResults) break;
  }

  return leads;
}

async function fetchMlhWithPlaywright(
  url: string,
  timeoutMs: number,
): Promise<{ html: string; warnings: string[] }> {
  const warnings: string[] = [];

  const html = await withPlaywright(
    async ({ page }) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page
        .locator('script[data-page="app"], .event-wrapper, .event-name, a[href*="/events/"]')
        .first()
        .waitFor({ state: "attached", timeout: Math.min(timeoutMs, 8_000) })
        .catch(() => {
          warnings.push("MLH listing content did not fully render within timeout.");
        });
      return page.content();
    },
    { timeoutMs },
  );

  return { html, warnings };
}

export const mlhCollector: Collector = {
  source: "mlh",

  async collect(input: CollectorInput): Promise<CollectorResult> {
    const startedAt = Date.now();
    const result = emptyCollectorResult("mlh", startedAt);
    const listingUrls = buildMlhListingUrls();
    const parseOptions: ParseMlhHtmlOptions = {
      now: new Date(),
      seasonYear: new Date().getUTCFullYear() + 1,
      baseUrl: MLH_BASE,
    };

    try {
      for (const seasonUrl of listingUrls) {
        if (Date.now() - startedAt > input.timeoutMs) {
          result.warnings.push("MLH collector stopped early after timeout budget.");
          break;
        }
        if (result.leads.length >= input.maxResults) break;

        const remaining = Math.max(1_000, input.timeoutMs - (Date.now() - startedAt));
        let html: string | undefined;

        try {
          html = await fetchHtml(seasonUrl, { timeoutMs: remaining, retries: 1 });
        } catch (error) {
          const status = error instanceof FetchHtmlError ? error.status : undefined;
          if (status === 403 || status === 429) {
            result.warnings.push(
              `MLH static fetch returned HTTP ${status} for ${seasonUrl}; trying Playwright.`,
            );
          } else {
            result.warnings.push(
              error instanceof Error ? error.message : `MLH fetch failed for ${seasonUrl}`,
            );
          }
        }

        if (html) {
          const pageLeads = parseMlhHtml(html, input.maxResults, {
            ...parseOptions,
            baseUrl: seasonUrl,
          });
          if (pageLeads.length > 0) {
            result.leads = pageLeads;
            break;
          }
        }

        if (!html || result.leads.length === 0) {
          try {
            const rendered = await fetchMlhWithPlaywright(seasonUrl, remaining);
            result.warnings.push(...rendered.warnings);
            const pageLeads = parseMlhHtml(rendered.html, input.maxResults, {
              ...parseOptions,
              baseUrl: seasonUrl,
            });
            if (pageLeads.length > 0) {
              result.leads = pageLeads;
              break;
            }
          } catch (error) {
            if (isPlaywrightBrowserMissingError(error)) {
              result.warnings.push(formatPlaywrightInstallHint());
            } else {
              result.warnings.push(
                error instanceof Error ? error.message : "MLH Playwright fallback failed",
              );
            }
          }
        }
      }

      if (result.leads.length === 0) {
        result.warnings.push("MLH returned no upcoming event cards.");
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : "MLH fetch failed");
    }

    result.durationMs = Date.now() - startedAt;
    return result;
  },
};
