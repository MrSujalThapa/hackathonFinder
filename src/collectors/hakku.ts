import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { BrowserContext, Page } from "playwright";
import type { RawLead } from "@/core/discovery/types";
import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";
import {
  detectHakkuAuth,
  filterUpcomingHakkuCards,
  type HakkuAuthStatus,
  type HakkuCollectMode,
  type HakkuStopReason,
} from "@/lib/browser/hakkuAuth";
import {
  formatPlaywrightInstallHint,
  isPlaywrightBrowserMissingError,
  readHakkuBrowserHeadless,
  redactProfilePaths,
  resolveHakkuProfileDir,
  withPersistentPlaywright,
} from "@/lib/browser/playwright";
import { hakkuProfileExists, writeHakkuSessionMeta } from "@/lib/browser/sessionMeta";
import { collectUntilStable } from "@/lib/browser/collectUntilStable";
import { normalizeUrl, normalizeUrlForDedupe, slugify, uniqueUrls } from "@/lib/http/url";

export const HAKKU_EXPLORE_URL = "https://www.hakku.app/explore";
export const HAKKU_SWIPE_URL = HAKKU_EXPLORE_URL;
const HAKKU_ORIGIN = "https://www.hakku.app";

const HAKKU_MAX_SCROLLS = 30;
const HAKKU_MAX_EVENTS = 100;
const HAKKU_NO_GROWTH_LIMIT = 3;
const HAKKU_SCROLL_WAIT_MS = 1_200;
const HAKKU_DETAIL_LIMIT = 20;
const HAKKU_DETAIL_CONCURRENCY = 2;
const HAKKU_DETAIL_TIMEOUT_MS = 8_000;
const CONTENT_SELECTOR = "main, h1, h2, h3, a, button, input[type='password'], form";

const MONTH_RE =
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\b/i;
const FORMAT_RE = /\b(in[- ]?person|online|virtual|remote|hybrid)\b/i;
const EVENT_CONTROL_RE = /\b(visit site|apply|register|save|saved)\b/i;

export type HakkuCard = {
  title: string;
  url?: string;
  hakkuDetailUrl?: string;
  externalEventUrl?: string;
  devpostUrl?: string;
  organizer?: string;
  dateText?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  format?: string;
  prizeSummary?: string;
  contactEmail?: string;
  text?: string;
  links: string[];
  tags: string[];
};

export type HakkuParserDiagnostics = {
  candidateContainers: number;
  validCards: number;
  visitSiteButtons: number;
  saveButtons: number;
  eventTitleCount: number;
  dateRowCount: number;
  clickableCardCount: number;
  detailPagesOpened: number;
  detailPagesParsed: number;
  detailFailures: number;
  scrollAttempts: number;
  noGrowthAttempts: number;
};

export type HakkuExtractResult = {
  cards: HakkuCard[];
  authStatus: HakkuAuthStatus;
  pagesInspected: number;
  mode: HakkuCollectMode;
  stopReason: HakkuStopReason;
  diagnostics: HakkuParserDiagnostics;
};

export type HakkuDetail = Partial<Omit<HakkuCard, "links" | "tags">> & {
  links?: string[];
  tags?: string[];
};

function emptyHakkuDiagnostics(): HakkuParserDiagnostics {
  return {
    candidateContainers: 0,
    validCards: 0,
    visitSiteButtons: 0,
    saveButtons: 0,
    eventTitleCount: 0,
    dateRowCount: 0,
    clickableCardCount: 0,
    detailPagesOpened: 0,
    detailPagesParsed: 0,
    detailFailures: 0,
    scrollAttempts: 0,
    noGrowthAttempts: 0,
  };
}

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function isHakkuInternalUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === new URL(HAKKU_ORIGIN).hostname;
  } catch {
    return false;
  }
}

function isMapUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase().includes("google.") && parsed.pathname.includes("/maps");
  } catch {
    return false;
  }
}

function toAbsoluteUrl(raw: string | undefined, base = HAKKU_ORIGIN): string | undefined {
  if (!raw) return undefined;
  return normalizeUrl(raw, base);
}

function allAnchorUrls(
  root: cheerio.Cheerio<AnyNode>,
  $: cheerio.CheerioAPI,
  base = HAKKU_ORIGIN,
): string[] {
  return uniqueUrls(
    root
      .find("a[href]")
      .map((_index, element) => toAbsoluteUrl($(element).attr("href"), base) ?? "")
      .get(),
    base,
  );
}

function firstAnchorUrlByText(
  root: cheerio.Cheerio<AnyNode>,
  $: cheerio.CheerioAPI,
  pattern: RegExp,
  base = HAKKU_ORIGIN,
): string | undefined {
  return root
    .find("a[href]")
    .map((_index, element) => {
      const anchor = $(element);
      if (!pattern.test(cleanText(anchor.text()))) return "";
      return toAbsoluteUrl(anchor.attr("href"), base) ?? "";
    })
    .get()
    .filter(Boolean)[0];
}

function extractHakkuDetailUrl(
  root: cheerio.Cheerio<AnyNode>,
  $: cheerio.CheerioAPI,
): string | undefined {
  return root
    .find("a[href]")
    .map((_index, element) => {
      const url = toAbsoluteUrl($(element).attr("href"));
      if (!url || !isHakkuInternalUrl(url)) return "";
      try {
        const pathName = new URL(url).pathname.toLowerCase();
        if (
          pathName === "/" ||
          pathName === "/explore" ||
          pathName.startsWith("/login") ||
          pathName.startsWith("/auth")
        ) {
          return "";
        }
        return url;
      } catch {
        return "";
      }
    })
    .get()
    .filter(Boolean)[0];
}

function extractExternalEventUrl(
  root: cheerio.Cheerio<AnyNode>,
  $: cheerio.CheerioAPI,
  base = HAKKU_ORIGIN,
): string | undefined {
  const visitSite = firstAnchorUrlByText(root, $, /\b(visit site|apply|register)\b/i, base);
  if (visitSite && !isMapUrl(visitSite)) return visitSite;

  return allAnchorUrls(root, $, base).find((url) => !isMapUrl(url) && !isHakkuInternalUrl(url));
}

function extractLocation(
  root: cheerio.Cheerio<AnyNode>,
  $: cheerio.CheerioAPI,
): string | undefined {
  const mapText = root
    .find("a[href]")
    .map((_index, element) => {
      const anchor = $(element);
      const url = toAbsoluteUrl(anchor.attr("href"));
      if (!url || !isMapUrl(url)) return "";
      return cleanText(anchor.text());
    })
    .get()
    .find((text) => text.length > 0);
  if (mapText) return mapText;

  return root
    .find("p, span, div")
    .map((_index, element) => cleanText($(element).text()))
    .get()
    .find((text) => /^TBA$/i.test(text));
}

function extractDateText(
  root: cheerio.Cheerio<AnyNode>,
  $: cheerio.CheerioAPI,
): string | undefined {
  const candidates = root
    .find("time, span, div, p")
    .map((_index, element) => cleanText($(element).text()).replace(/^(date|dates)\s*:\s*/i, ""))
    .get()
    .filter((text) => text.length > 0 && text.length < 90)
    .filter((text) => MONTH_RE.test(text) && /\d/.test(text));

  return candidates.find((text) => !/^deadline\b/i.test(text)) ?? candidates[0];
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function parseHakkuDateRange(dateText: string | undefined): {
  startDate?: string;
  endDate?: string;
} {
  if (!dateText) return {};
  const match = dateText.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:\s*[\u2013-]\s*(\d{1,2}))?(?:,\s*(\d{4}))?/i,
  );
  if (!match) return {};

  const month = MONTHS[(match[1] ?? "").toLowerCase()];
  const startDay = Number(match[2]);
  const endDay = match[3] ? Number(match[3]) : undefined;
  const year = match[4] ? Number(match[4]) : new Date().getFullYear();
  if (!month || !Number.isFinite(startDay)) return {};

  return {
    startDate: `${year}-${pad2(month)}-${pad2(startDay)}`,
    endDate: endDay && Number.isFinite(endDay) ? `${year}-${pad2(month)}-${pad2(endDay)}` : undefined,
  };
}

function extractFormat(
  root: cheerio.Cheerio<AnyNode>,
  $: cheerio.CheerioAPI,
): string | undefined {
  return root
    .find("span, div")
    .map((_index, element) => cleanText($(element).text()))
    .get()
    .filter((text) => text.length > 0 && text.length <= 40)
    .find((text) => FORMAT_RE.test(text));
}

function extractParagraphFields(
  root: cheerio.Cheerio<AnyNode>,
  $: cheerio.CheerioAPI,
  title: string,
  location?: string,
): { description?: string; organizer?: string } {
  const paragraphs = root
    .find("p")
    .map((_index, element) => cleanText($(element).text()))
    .get()
    .filter((text) => text.length > 0)
    .filter((text) => text !== title && text !== location)
    .filter((text) => !/^TBA$/i.test(text));

  const description = paragraphs.find((text) => text.length >= 30);
  const organizer = paragraphs.find(
    (text) =>
      text !== description &&
      text.length >= 3 &&
      text.length <= 120 &&
      !MONTH_RE.test(text) &&
      !EVENT_CONTROL_RE.test(text),
  );
  return { description, organizer };
}

function extractTags(
  root: cheerio.Cheerio<AnyNode>,
  $: cheerio.CheerioAPI,
  fields: { title: string; location?: string; dateText?: string; description?: string },
): string[] {
  const excluded = new Set(
    [fields.title, fields.location, fields.dateText, fields.description, "Visit Site", "Save", "Saved"]
      .filter(Boolean)
      .map((text) => cleanText(text).toLowerCase()),
  );

  const tags = root
    .find("span, button")
    .map((_index, element) => cleanText($(element).text()))
    .get()
    .filter((text) => text.length > 0 && text.length <= 45)
    .filter((text) => !excluded.has(text.toLowerCase()))
    .filter((text) => !/^visit site|save|saved$/i.test(text))
    .filter((text) => !MONTH_RE.test(text));

  return Array.from(new Set(tags));
}

function looksLikeExploreCard(
  root: cheerio.Cheerio<AnyNode>,
  $: cheerio.CheerioAPI,
): boolean {
  const title = cleanText(root.find("h1, h2, h3, h4, h5, h6").first().text());
  if (!title || title.length < 3 || title.length > 140) return false;
  if (/^(explore|saved events|settings|login|sign in|sign up)$/i.test(title)) return false;

  const text = cleanText(root.text());
  if (text.length < 35 || text.length > 2_500) return false;

  const hasVisitSite = root
    .find("a[href]")
    .toArray()
    .some((element) => /\b(visit site|apply|register)\b/i.test(cleanText($(element).text())));
  const hasSave = root
    .find("button")
    .toArray()
    .some((element) => /\bsave(d)?\b/i.test(cleanText($(element).text())));
  return hasVisitSite || hasSave;
}

export function extractHakkuCardsFromHtml(
  html: string,
  maxResults = HAKKU_MAX_EVENTS,
): { cards: HakkuCard[]; diagnostics: HakkuParserDiagnostics } {
  const $ = cheerio.load(html);
  const diagnostics = emptyHakkuDiagnostics();

  diagnostics.visitSiteButtons = $("a, button")
    .toArray()
    .filter((element) => /\bvisit site\b/i.test(cleanText($(element).text()))).length;
  diagnostics.saveButtons = $("button")
    .toArray()
    .filter((element) => /\bsave(d)?\b/i.test(cleanText($(element).text()))).length;
  diagnostics.eventTitleCount = $("h1, h2, h3, h4, h5, h6")
    .toArray()
    .filter((element) => {
      const text = cleanText($(element).text());
      return text.length >= 3 && !/^(explore|saved events|settings)$/i.test(text);
    }).length;
  diagnostics.dateRowCount = $("time, span, div, p")
    .toArray()
    .filter((element) => {
      const text = cleanText($(element).text());
      return text.length > 0 && text.length < 90 && MONTH_RE.test(text) && /\d/.test(text);
    }).length;

  const candidates = $("div, article, section")
    .toArray()
    .map((element) => ({ element, length: cleanText($(element).text()).length }))
    .filter(({ element }) => looksLikeExploreCard($(element), $))
    .sort((a, b) => a.length - b.length);

  diagnostics.candidateContainers = candidates.length;
  diagnostics.clickableCardCount = candidates.filter(({ element }) => {
    const root = $(element);
    return (
      root.is("[role='button'], [tabindex]") ||
      root.find("[role='button'], [tabindex], .cursor-pointer, [class*='cursor-pointer']").length > 0
    );
  }).length;

  const cards: HakkuCard[] = [];
  const seen = new Set<string>();

  for (const { element } of candidates) {
    const root = $(element);
    const title = cleanText(root.find("h1, h2, h3, h4, h5, h6").first().text());
    if (!title) continue;

    const links = allAnchorUrls(root, $);
    const explicitHakkuDetailUrl = extractHakkuDetailUrl(root, $);
    const hasClickableDetailAffordance =
      root.is("[role='button'], [tabindex]") ||
      root.find("[role='button'], [tabindex], .cursor-pointer, [class*='cursor-pointer']").length > 0;
    const hakkuDetailUrl =
      explicitHakkuDetailUrl ??
      (hasClickableDetailAffordance ? `${HAKKU_ORIGIN}/events/${slugify(title)}` : undefined);
    const externalEventUrl = extractExternalEventUrl(root, $);
    const devpostUrl = links.find((url) => {
      try {
        return new URL(url).hostname.toLowerCase().endsWith("devpost.com") && !isHakkuInternalUrl(url);
      } catch {
        return false;
      }
    });
    const location = extractLocation(root, $);
    const dateText = extractDateText(root, $);
    const dates = parseHakkuDateRange(dateText);
    const format = extractFormat(root, $);
    const paragraphs = extractParagraphFields(root, $, title, location);
    const hasEventShape = Boolean(
      externalEventUrl ||
        hakkuDetailUrl ||
        dateText ||
        location ||
        /\bhackathon|hacker|build\b/i.test(cleanText(root.text())),
    );
    if (!hasEventShape) continue;
    const tags = extractTags(root, $, {
      title,
      location,
      dateText,
      description: paragraphs.description,
    });

    const cardKey = normalizeUrlForDedupe(
      externalEventUrl ?? hakkuDetailUrl ?? `${HAKKU_EXPLORE_URL}#${slugify(title)}`,
    );
    const titleKey = `${slugify(title)}:${cardKey}`;
    if (seen.has(titleKey)) continue;
    seen.add(titleKey);

    cards.push({
      title,
      url: externalEventUrl ?? hakkuDetailUrl,
      hakkuDetailUrl,
      externalEventUrl,
      devpostUrl,
      organizer: paragraphs.organizer,
      dateText,
      startDate: dates.startDate,
      endDate: dates.endDate,
      location,
      format,
      text: paragraphs.description,
      links,
      tags,
    });

    if (cards.length >= maxResults) break;
  }

  diagnostics.validCards = cards.length;
  return { cards, diagnostics };
}

function findLabeledValue(text: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escaped}\\s*:?\\s*([^\\n|]{3,140})`, "i"));
  return match ? cleanText(match[1]) : undefined;
}

function findLabeledLineValue(lines: string[], label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const line of lines) {
    const match = line.match(new RegExp(`^${escaped}\\s*:?\\s*(.{3,140})$`, "i"));
    if (match) return cleanText(match[1]);
  }
  return undefined;
}

export function extractHakkuDetailFromHtml(html: string, detailUrl = HAKKU_ORIGIN): HakkuDetail {
  const $ = cheerio.load(html);
  const detailLines = $("body")
    .find("p, li, div")
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter(Boolean);
  const bodyText = detailLines.join(" ");
  const title =
    cleanText($("h1, h2, h3").first().text()) ||
    cleanText($("meta[property='og:title']").attr("content"));
  const description =
    cleanText($("meta[name='description'], meta[property='og:description']").first().attr("content")) ||
    $("p")
      .toArray()
      .map((element) => cleanText($(element).text()))
      .find((text) => text.length >= 40);
  const root = $("body");
  const links = allAnchorUrls(root, $, detailUrl);
  const externalEventUrl =
    firstAnchorUrlByText(root, $, /\b(visit site|apply|register)\b/i, detailUrl) ??
    links.find((url) => !isHakkuInternalUrl(url) && !isMapUrl(url));
  const devpostUrl = links.find((url) => {
    try {
      return new URL(url).hostname.toLowerCase().endsWith("devpost.com");
    } catch {
      return false;
    }
  });
  const dateText =
    extractDateText(root, $) ??
    findLabeledLineValue(detailLines, "Date") ??
    findLabeledLineValue(detailLines, "Dates") ??
    findLabeledValue(bodyText, "Date") ??
    findLabeledValue(bodyText, "Dates");
  const dates = parseHakkuDateRange(dateText);
  const location =
    extractLocation(root, $) ??
    findLabeledLineValue(detailLines, "Location") ??
    findLabeledValue(bodyText, "Location");
  const organizer =
    findLabeledLineValue(detailLines, "Organizer") ??
    findLabeledLineValue(detailLines, "Host") ??
    findLabeledValue(bodyText, "Organizer") ??
    findLabeledValue(bodyText, "Host");
  const prizeSummary =
    findLabeledLineValue(detailLines, "Prize") ??
    findLabeledLineValue(detailLines, "Prizes") ??
    findLabeledValue(bodyText, "Prize") ??
    findLabeledValue(bodyText, "Prizes");
  const contactEmail = bodyText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const tags = $("span, [class*='tag'], [class*='badge']")
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter((text) => text.length > 0 && text.length <= 45)
    .filter((text) => !MONTH_RE.test(text) && !EVENT_CONTROL_RE.test(text));

  return {
    title: title || undefined,
    text: description || undefined,
    dateText,
    ...dates,
    location,
    organizer,
    prizeSummary,
    contactEmail,
    externalEventUrl,
    devpostUrl,
    links,
    tags: Array.from(new Set(tags)),
  };
}

export function mergeHakkuDetail(card: HakkuCard, detail: HakkuDetail): HakkuCard {
  return {
    ...card,
    title: detail.title ?? card.title,
    url: detail.externalEventUrl ?? detail.hakkuDetailUrl ?? card.url,
    hakkuDetailUrl: detail.hakkuDetailUrl ?? card.hakkuDetailUrl,
    externalEventUrl: detail.externalEventUrl ?? card.externalEventUrl,
    devpostUrl: detail.devpostUrl ?? card.devpostUrl,
    organizer: detail.organizer ?? card.organizer,
    dateText: detail.dateText ?? card.dateText,
    startDate: detail.startDate ?? card.startDate,
    endDate: detail.endDate ?? card.endDate,
    location: detail.location ?? card.location,
    format: detail.format ?? card.format,
    prizeSummary: detail.prizeSummary ?? card.prizeSummary,
    contactEmail: detail.contactEmail ?? card.contactEmail,
    text: detail.text ?? card.text,
    links: uniqueUrls([...(card.links ?? []), ...(detail.links ?? [])], HAKKU_ORIGIN),
    tags: Array.from(new Set([...(card.tags ?? []), ...(detail.tags ?? [])])),
  };
}

function hakkuListingDataIsSufficient(card: HakkuCard): boolean {
  return Boolean(
    card.title &&
      (card.externalEventUrl || card.url || card.hakkuDetailUrl) &&
      (card.dateText || card.startDate || card.location || card.format) &&
      (card.externalEventUrl || card.text || card.tags.length > 0),
  );
}

function inferHakkuMode(card: HakkuCard): "online" | "in-person" | "hybrid" | undefined {
  const haystack = [card.format, card.location, card.text, ...card.tags].filter(Boolean).join(" ");
  if (/\bhybrid\b/i.test(haystack)) return "hybrid";
  if (/\b(online|virtual|remote)\b/i.test(haystack)) return "online";
  if (/\b(in[- ]?person|onsite|on-site)\b/i.test(haystack)) return "in-person";
  return undefined;
}

export function parseHakkuCards(cards: HakkuCard[], maxResults: number): RawLead[] {
  const leads: RawLead[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    const canonicalEventUrl = card.externalEventUrl ?? card.url ?? card.hakkuDetailUrl;
    const provenanceUrl = card.hakkuDetailUrl ?? `${HAKKU_EXPLORE_URL}#${slugify(card.title)}`;
    const key = canonicalEventUrl ? normalizeUrlForDedupe(canonicalEventUrl) : slugify(card.title);
    if (seen.has(key)) continue;
    seen.add(key);

    const links = uniqueUrls(
      [
        canonicalEventUrl,
        card.hakkuDetailUrl,
        card.devpostUrl,
        ...card.links,
        provenanceUrl,
      ].filter(Boolean) as string[],
      HAKKU_SWIPE_URL,
    );
    const mode = inferHakkuMode(card);

    leads.push({
      id: `hakku-${slugify(card.title)}`,
      source: "hakku",
      title: card.title,
      url: canonicalEventUrl ?? provenanceUrl,
      text: [card.text, card.dateText, card.location, ...card.tags].filter(Boolean).join(" - "),
      links: links.length > 0 ? links : [HAKKU_SWIPE_URL],
      postedAt: new Date().toISOString(),
      metadata: {
        organizer: card.organizer,
        dateText: card.dateText,
        startDate: card.startDate,
        endDate: card.endDate,
        location: card.location,
        format: card.format,
        prizeSummary: card.prizeSummary,
        contactEmail: card.contactEmail,
        themes: card.tags.filter((tag) => /ai|web3|cloud|agent|security|web|data/i.test(tag)),
        mode,
        officialUrl: card.externalEventUrl ?? card.url,
        applyUrl: card.externalEventUrl ?? card.url,
        externalEventUrl: card.externalEventUrl,
        devpostUrl: card.devpostUrl,
        hakkuDetailUrl: card.hakkuDetailUrl,
        discoveryMode: "authenticated_hakku_explore",
        provenance: "authenticated_hakku_explore",
        sourceIds: { hakku: slugify(card.title), hakkuExplore: provenanceUrl },
      },
    });

    if (leads.length >= maxResults) break;
  }

  return leads;
}

async function collectPageSignals(page: Page): Promise<{
  url: string;
  title: string;
  bodyText: string;
  hasSwipeCards: boolean;
  hasPasswordField: boolean;
}> {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 8_000);
  const hasPasswordField = (await page.locator("input[type='password']").count().catch(() => 0)) > 0;
  const legacyCardCount = await page
    .locator(
      "[data-testid='event-card'], [data-testid='swipe-card'], article.card, article, .event-card, .swipe-card, [class*='EventCard'], [class*='SwipeCard']",
    )
    .count()
    .catch(() => 0);
  const currentExploreControls =
    (await page.getByRole("link", { name: /visit site/i }).count().catch(() => 0)) +
    (await page.getByRole("button", { name: /^save(d)?$/i }).count().catch(() => 0));
  const hasSwipeCards = legacyCardCount + currentExploreControls > 0;

  return { url, title, bodyText, hasSwipeCards, hasPasswordField };
}

async function extractCardsFromPage(page: Page): Promise<{
  cards: HakkuCard[];
  diagnostics: HakkuParserDiagnostics;
}> {
  return extractHakkuCardsFromHtml(await page.content(), HAKKU_MAX_EVENTS);
}

async function collectExploreCards(
  page: Page,
  timeoutMs: number,
  logger?: (message: string) => void,
): Promise<{
  cards: HakkuCard[];
  diagnostics: HakkuParserDiagnostics;
  stopReason: HakkuStopReason;
}> {
  let parsed = await extractCardsFromPage(page);
  const collected = await collectUntilStable<HakkuCard>({
    collectItems: async () => {
      parsed = await extractCardsFromPage(page);
      return parsed.cards;
    },
    getKey: (card) =>
      normalizeUrlForDedupe(
        card.externalEventUrl ?? card.hakkuDetailUrl ?? card.url ?? `${HAKKU_EXPLORE_URL}#${slugify(card.title)}`,
      ),
    scroll: async () => {
      await page.mouse.wheel(0, 2200).catch(() => undefined);
    },
    waitForIdle: async () => {
      await page.waitForLoadState("networkidle", { timeout: HAKKU_SCROLL_WAIT_MS }).catch(() => undefined);
    },
    maxItems: HAKKU_MAX_EVENTS,
    maxScrolls: HAKKU_MAX_SCROLLS,
    noGrowthLimit: HAKKU_NO_GROWTH_LIMIT,
    timeoutMs,
    waitMs: HAKKU_SCROLL_WAIT_MS,
    logger,
    loadingMessage: "Loading more cards...",
    countMessage: (count) => `${count} unique cards found`,
  });

  const diagnostics = {
    ...parsed.diagnostics,
    validCards: collected.items.length,
    scrollAttempts: collected.scrollAttempts,
    noGrowthAttempts: collected.noGrowthAttempts,
  };
  const stopReason: HakkuStopReason =
    collected.items.length === 0 && diagnostics.candidateContainers > 0
      ? "parser_failure"
      : collected.items.length === 0
        ? "no_cards"
        : collected.stopReason === "timeout"
          ? "timeout"
          : "completed";

  if (collected.stopReason === "no_growth") {
    logger?.(`No additional cards after ${collected.noGrowthAttempts} attempts`);
  }
  logger?.("Lazy loading complete");
  return { cards: collected.items, diagnostics, stopReason };
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

async function enrichHakkuDetails(
  context: BrowserContext,
  cards: HakkuCard[],
  maxDetails: number,
  logger?: (message: string) => void,
): Promise<{ cards: HakkuCard[]; opened: number; parsed: number; failures: number }> {
  const targets = cards
    .filter((card) => card.hakkuDetailUrl && !hakkuListingDataIsSufficient(card))
    .slice(0, Math.min(HAKKU_DETAIL_LIMIT, maxDetails));
  if (targets.length === 0) return { cards, opened: 0, parsed: 0, failures: 0 };

  logger?.(`Opening up to ${targets.length} Hakku detail pages...`);
  const byDetailUrl = new Map(targets.map((card) => [card.hakkuDetailUrl, card]));
  let opened = 0;
  let parsed = 0;
  let failures = 0;

  await mapLimit(targets, HAKKU_DETAIL_CONCURRENCY, async (card) => {
    const detailUrl = card.hakkuDetailUrl;
    if (!detailUrl) return;
    let detailPage: Page | undefined;
    opened += 1;
    try {
      detailPage = await context.newPage();
      await detailPage
        .goto(detailUrl, {
          waitUntil: "domcontentloaded",
          timeout: HAKKU_DETAIL_TIMEOUT_MS,
        })
        .catch(() => undefined);
      await detailPage
        .locator(CONTENT_SELECTOR)
        .first()
        .waitFor({ state: "visible", timeout: Math.min(4_000, HAKKU_DETAIL_TIMEOUT_MS) })
        .catch(() => undefined);
      const detail = extractHakkuDetailFromHtml(
        await detailPage.content(),
        detailUrl,
      );
      if (detail.title || detail.text || detail.externalEventUrl || detail.dateText) {
        byDetailUrl.set(detailUrl, mergeHakkuDetail(card, detail));
        parsed += 1;
      } else {
        failures += 1;
      }
    } catch {
      failures += 1;
    } finally {
      await detailPage?.close().catch(() => undefined);
    }
  });

  return {
    cards: cards.map((card) =>
      card.hakkuDetailUrl ? byDetailUrl.get(card.hakkuDetailUrl) ?? card : card,
    ),
    opened,
    parsed,
    failures,
  };
}

async function captureFailureScreenshot(page: Page, label: string): Promise<void> {
  try {
    const dir = path.join(os.tmpdir(), "hackathon-finder-hakku-debug");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `hakku-${label}-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: true });
  } catch {
    // Debug artifacts are best-effort only.
  }
}

export async function probeHakkuAuth(options: {
  profileDir: string;
  timeoutMs?: number;
  headless?: boolean;
  captureFailure?: boolean;
}): Promise<{ authStatus: HakkuAuthStatus; pagesInspected: number }> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  return withPersistentPlaywright(
    options.profileDir,
    async ({ page }) => {
      let pagesInspected = 0;
      try {
        await page.goto(HAKKU_SWIPE_URL, {
          waitUntil: "domcontentloaded",
          timeout: timeoutMs,
        });
        pagesInspected = 1;
        await page
          .locator(CONTENT_SELECTOR)
          .first()
          .waitFor({ state: "visible", timeout: Math.min(timeoutMs, 8_000) })
          .catch(() => undefined);

        const signals = await collectPageSignals(page);
        const authStatus = detectHakkuAuth(signals);
        if (authStatus === "login_required" && options.captureFailure) {
          await captureFailureScreenshot(page, "auth-required");
        }
        return { authStatus, pagesInspected };
      } catch (error) {
        if (options.captureFailure) {
          await captureFailureScreenshot(page, "probe-error");
        }
        throw error;
      }
    },
    { timeoutMs, headless: options.headless ?? true },
  );
}

async function extractVisibleHakkuCards(options: {
  profileDir: string;
  timeoutMs: number;
  headless: boolean;
  maxResults: number;
  logger?: (message: string) => void;
}): Promise<HakkuExtractResult> {
  const { profileDir, timeoutMs, headless, maxResults, logger } = options;

  return withPersistentPlaywright(
    profileDir,
    async ({ page, context }) => {
      let pagesInspected = 0;
      try {
        logger?.("Opening https://www.hakku.app/explore");
        await page.goto(HAKKU_EXPLORE_URL, {
          waitUntil: "domcontentloaded",
          timeout: timeoutMs,
        });
        pagesInspected = 1;

        await page
          .locator(CONTENT_SELECTOR)
          .first()
          .waitFor({ state: "visible", timeout: Math.min(timeoutMs, 8_000) })
          .catch(() => undefined);

        let signals = await collectPageSignals(page);
        let authStatus = detectHakkuAuth(signals);

        if (authStatus === "login_required") {
          await captureFailureScreenshot(page, "auth-required");
          return {
            cards: [],
            authStatus,
            pagesInspected,
            mode: "unauthenticated",
            stopReason: "auth_required",
            diagnostics: emptyHakkuDiagnostics(),
          };
        }

        if (authStatus === "authenticated") {
          logger?.("Persistent session authenticated");
        }

        if (!signals.url.includes("/explore")) {
          await page.goto(HAKKU_EXPLORE_URL, {
            waitUntil: "domcontentloaded",
            timeout: Math.min(timeoutMs, 10_000),
          });
          pagesInspected += 1;
          await page
            .locator(CONTENT_SELECTOR)
            .first()
            .waitFor({ state: "visible", timeout: Math.min(timeoutMs, 5_000) })
            .catch(() => undefined);
          signals = await collectPageSignals(page);
          authStatus = detectHakkuAuth(signals);
          if (authStatus === "login_required") {
            await captureFailureScreenshot(page, "auth-required");
            return {
              cards: [],
              authStatus,
              pagesInspected,
              mode: "unauthenticated",
              stopReason: "auth_required",
              diagnostics: emptyHakkuDiagnostics(),
            };
          }
          if (authStatus === "authenticated") {
            logger?.("Persistent session authenticated");
          }
        }

        logger?.("Explore directory loaded");
        const collected = await collectExploreCards(page, timeoutMs, logger);
        const enriched = await enrichHakkuDetails(context, collected.cards, maxResults, logger);
        const diagnostics = {
          ...collected.diagnostics,
          detailPagesOpened: enriched.opened,
          detailPagesParsed: enriched.parsed,
          detailFailures: enriched.failures,
        };
        const cards = filterUpcomingHakkuCards(enriched.cards);
        const mode: HakkuCollectMode =
          authStatus === "authenticated" ? "authenticated" : "public";

        return {
          cards,
          authStatus,
          pagesInspected,
          mode,
          stopReason:
            collected.stopReason === "completed" && cards.length === 0
              ? "no_cards"
              : collected.stopReason,
          diagnostics,
        };
      } catch (error) {
        await captureFailureScreenshot(page, "collect-error");
        if (error instanceof Error) {
          error.message = redactProfilePaths(error.message, profileDir);
        }
        throw error;
      }
    },
    { timeoutMs, headless },
  );
}

function applyHakkuMetrics(
  result: CollectorResult,
  extract: HakkuExtractResult,
  accepted: number,
): void {
  const authCode =
    extract.authStatus === "authenticated" ? 1 : extract.authStatus === "login_required" ? 0 : -1;
  const modeCode =
    extract.mode === "authenticated" ? 1 : extract.mode === "public" ? 0 : -1;

  result.metrics = {
    pagesInspected: extract.pagesInspected,
    rawLeads: extract.cards.length,
    accepted,
    authStatus: authCode,
    mode: modeCode,
    candidateContainers: extract.diagnostics.candidateContainers,
    validCards: extract.diagnostics.validCards,
    visitSiteButtons: extract.diagnostics.visitSiteButtons,
    saveButtons: extract.diagnostics.saveButtons,
    eventTitleCount: extract.diagnostics.eventTitleCount,
    dateRowCount: extract.diagnostics.dateRowCount,
    clickableCardCount: extract.diagnostics.clickableCardCount,
    detailPagesOpened: extract.diagnostics.detailPagesOpened,
    detailPagesParsed: extract.diagnostics.detailPagesParsed,
    detailFailures: extract.diagnostics.detailFailures,
    scrollAttempts: extract.diagnostics.scrollAttempts,
    noGrowthAttempts: extract.diagnostics.noGrowthAttempts,
  };

  result.warnings.push(`mode=${extract.mode}`);
  result.warnings.push(`auth_status=${extract.authStatus}`);
  result.warnings.push(`stop_reason=${extract.stopReason}`);
  result.warnings.push(`unique_cards=${extract.cards.length}`);
  result.warnings.push(`scrolls=${extract.diagnostics.scrollAttempts}`);
  result.warnings.push(`no_growth_attempts=${extract.diagnostics.noGrowthAttempts}`);
  result.warnings.push(`details_opened=${extract.diagnostics.detailPagesOpened}`);
  result.warnings.push(`details_parsed=${extract.diagnostics.detailPagesParsed}`);
  result.warnings.push(`detail_failures=${extract.diagnostics.detailFailures}`);
  result.diagnostics = {
    discovered: extract.cards.length,
    returned: accepted,
    enriched: extract.diagnostics.detailPagesParsed,
    partial: extract.diagnostics.detailFailures,
    dropped: Math.max(0, extract.cards.length - accepted),
    stopReason: extract.stopReason,
    safeMessage:
      accepted === 0 && extract.cards.length > 0
        ? "Hakku discovered explore cards but returned no leads."
        : undefined,
  };
  result.status =
    extract.authStatus === "login_required"
      ? "auth_required"
      : result.errors.length > 0
        ? "failed"
        : extract.stopReason === "parser_failure" || extract.stopReason === "timeout"
          ? "degraded"
          : "completed";
}

export const hakkuCollector: Collector = {
  source: "hakku",

  async collect(input: CollectorInput): Promise<CollectorResult> {
    const startedAt = Date.now();
    const result = emptyCollectorResult("hakku", startedAt);
    const profileDir = resolveHakkuProfileDir();
    const headless = readHakkuBrowserHeadless(process.env, true);

    try {
      if (!hakkuProfileExists()) {
        result.errors.push(
          "auth_required: Hakku browser profile is missing. Run: npm run source:connect -- hakku",
        );
        result.warnings.push("mode=unauthenticated");
        result.warnings.push("auth_status=login_required");
        result.warnings.push("stop_reason=profile_missing");
        result.metrics = {
          pagesInspected: 0,
          rawLeads: 0,
          accepted: 0,
          authStatus: 0,
          mode: -1,
        };
        result.status = "auth_required";
        result.diagnostics = {
          discovered: 0,
          returned: 0,
          enriched: 0,
          partial: 0,
          dropped: 0,
          stopReason: "profile_missing",
          safeMessage: "Hakku browser profile is missing.",
        };
        writeHakkuSessionMeta("profile_missing");
        result.durationMs = Date.now() - startedAt;
        return result;
      }

      const extract = await extractVisibleHakkuCards({
        profileDir,
        timeoutMs: input.timeoutMs,
        headless,
        maxResults: input.maxResults,
        logger: input.logger,
      });

      if (extract.stopReason === "auth_required") {
        result.leads = [];
        result.errors.push(
          "auth_required: Hakku session is not authenticated (login redirect detected).",
        );
        applyHakkuMetrics(result, extract, 0);
        writeHakkuSessionMeta("reconnect_required");
        result.durationMs = Date.now() - startedAt;
        return result;
      }

      const acceptedCards = extract.cards.slice(0, input.maxResults);
      result.leads = parseHakkuCards(acceptedCards, input.maxResults);
      applyHakkuMetrics(result, extract, result.leads.length);
      if (result.leads.length > 0) {
        input.logger?.(`${result.leads.length} leads found`);
      }

      if (extract.authStatus === "authenticated") {
        writeHakkuSessionMeta("connected");
      } else if (extract.authStatus === "unknown") {
        writeHakkuSessionMeta("unknown");
      }

      if (result.leads.length === 0 && extract.stopReason === "parser_failure") {
        input.logger?.("Explore loaded, but no event cards matched the parser");
        result.status = "degraded";
        result.warnings.push(
          `parser failure: Explore page loaded and candidate controls were detected, but event cards could not be normalized. candidate_containers=${extract.diagnostics.candidateContainers} visit_site_buttons=${extract.diagnostics.visitSiteButtons} event_titles=${extract.diagnostics.eventTitleCount} date_rows=${extract.diagnostics.dateRowCount} clickable_cards=${extract.diagnostics.clickableCardCount}`,
        );
      } else if (result.leads.length === 0 && extract.stopReason === "no_cards") {
        input.logger?.("Explore loaded, but no event cards matched the parser");
        result.status = "degraded";
        result.warnings.push("Explore loaded, but no event cards matched the parser.");
      }
    } catch (error) {
      if (isPlaywrightBrowserMissingError(error)) {
        result.errors.push(formatPlaywrightInstallHint());
        result.warnings.push("stop_reason=browser_missing");
      } else {
        const message =
          error instanceof Error
            ? redactProfilePaths(error.message, profileDir)
            : "Hakku collection failed";
        result.errors.push(message);
        result.warnings.push("stop_reason=error");
      }
      result.metrics = {
        pagesInspected: result.metrics?.pagesInspected ?? 0,
        rawLeads: 0,
        accepted: 0,
        authStatus: -1,
        mode: -1,
      };
      result.status = result.errors.some((error) => /auth|login|sign[\s-]?in|session/i.test(error))
        ? "auth_required"
        : "failed";
      result.diagnostics = {
        discovered: 0,
        returned: 0,
        enriched: 0,
        partial: 0,
        dropped: 0,
        stopReason: "error",
        safeMessage: result.errors[0],
      };
    }

    result.durationMs = Date.now() - startedAt;
    return result;
  },
};

// Keep origin constant available for tests without exporting secrets/paths.
export const HAKKU_PUBLIC_ORIGIN = HAKKU_ORIGIN;
