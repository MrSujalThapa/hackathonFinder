import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type { RawLead } from "@/core/discovery/types";
import { emptyCollectorResult, type CollectorResult } from "@/collectors/types";
import type { CustomSource, CustomSourceStrategy } from "@/server/customSources/types";
import { fetchHtml } from "@/lib/http/fetchHtml";
import { normalizeUrl, normalizeUrlForDedupe, slugify, uniqueUrls } from "@/lib/http/url";
import { withPlaywright } from "@/lib/browser/playwright";
import { updateCustomSourceHealth } from "@/server/customSources/repository";
import { assertSafeCustomSourceUrl } from "@/server/customSources/urlSafety";

const EVENT_HINT =
  /\b(event|hackathon|challenge|competition|buildathon|codefest|workshop|summit|meetup|demo day|registration)\b/i;
const DATE_HINT =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/i;
const DOMAIN_HINT = /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i;
const DETAIL_LIMIT = 10;
const STATIC_CHECK_TIMEOUT_MS = readBoundedInt("CUSTOM_STATIC_CHECK_TIMEOUT_MS", 15_000, 1_000, 60_000);
const PLAYWRIGHT_CHECK_TIMEOUT_MS = readBoundedInt("CUSTOM_PLAYWRIGHT_CHECK_TIMEOUT_MS", 30_000, 5_000, 90_000);
const CUSTOM_MAX_PAGES = readBoundedInt("CUSTOM_MAX_PAGES", 20, 1, 50);
const CUSTOM_PAGE_NO_GROWTH_LIMIT = readBoundedInt("CUSTOM_PAGE_NO_GROWTH_LIMIT", 2, 1, 10);
const CUSTOM_PAGE_TIMEOUT_MS = readBoundedInt("CUSTOM_PAGE_TIMEOUT_MS", 12_000, 1_000, 60_000);

type ExtractionStrategy =
  | "card_grid"
  | "data_table"
  | "repeated_event_sections"
  | "semantic_list"
  | "generic_repeated_link";

type ParsedListing = {
  title: string;
  url: string;
  text: string;
  discoveryMode: string;
  officialUrl?: string;
  listingUrl?: string;
  startDateRaw?: string;
  location?: string;
  format?: string;
  prizeSummary?: string;
  participantsRaw?: string;
  sponsors?: string[];
  reviewReasons?: string[];
};

type ExtractionDiagnostics = {
  strategy: ExtractionStrategy;
  candidates: number;
  valid: number;
  detectedUnits: number;
  candidateUnits: number;
  normalizedLeads: number;
  rejectedDuringParsing: number;
  underExtracted: boolean;
  tables: number;
  dataRows: number;
  eventSections: number;
  cardCandidates: number;
  headers: string[];
  subscriptionLimited: boolean;
  hiddenCountText?: string;
  parserFailures: string[];
};

type ExtractionResult = {
  listings: ParsedListing[];
  diagnostics: ExtractionDiagnostics;
};

type RenderedCollection = ExtractionResult & {
  pagesVisited: number;
  stopReason: string;
};

type MinimalPage = {
  waitForFunction: (
    pageFunction: string | (() => unknown) | ((arg: string) => unknown),
    arg?: unknown,
    options?: { timeout?: number },
  ) => Promise<unknown>;
  waitForTimeout: (timeout: number) => Promise<void>;
  evaluate: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
};

const EMPTY_DIAGNOSTICS: ExtractionDiagnostics = {
  strategy: "card_grid",
  candidates: 0,
  valid: 0,
  detectedUnits: 0,
  candidateUnits: 0,
  normalizedLeads: 0,
  rejectedDuringParsing: 0,
  underExtracted: false,
  tables: 0,
  dataRows: 0,
  eventSections: 0,
  cardCandidates: 0,
  headers: [],
  subscriptionLimited: false,
  parserFailures: [],
};

function readBoundedInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function cleanText(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeMaybeUrl(raw: string | undefined, baseUrl: string): string | undefined {
  const value = cleanText(raw);
  if (!value || value.includes("...")) return undefined;
  if (/^(?:mailto|tel|javascript):/i.test(value)) return undefined;
  if (DOMAIN_HINT.test(value) && !/^https?:\/\//i.test(value)) {
    return normalizeUrl(`https://${value}`, baseUrl);
  }
  return normalizeUrl(value, baseUrl);
}

function isDirectionsLink(text: string, href: string): boolean {
  return /directions|map|google\.com\/maps|maps\.app\.goo\.gl/i.test(`${text} ${href}`);
}

function listingKey(listing: ParsedListing): string {
  return normalizeUrlForDedupe(listing.officialUrl ?? listing.url) || slugify(`${listing.title}-${listing.startDateRaw ?? ""}`);
}

function dedupeListings(listings: ParsedListing[], maxItems: number): ParsedListing[] {
  const seen = new Set<string>();
  const out: ParsedListing[] = [];
  for (const listing of listings) {
    const key = listingKey(listing);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(listing);
    if (out.length >= maxItems) break;
  }
  return out;
}

function extractionQuality(
  detectedUnits: number,
  normalizedLeads: number,
): Pick<
  ExtractionDiagnostics,
  "detectedUnits" | "candidateUnits" | "normalizedLeads" | "rejectedDuringParsing" | "underExtracted"
> {
  const safeDetected = Math.max(0, detectedUnits);
  const safeNormalized = Math.max(0, normalizedLeads);
  const ratio = safeDetected === 0 ? 1 : safeNormalized / safeDetected;
  return {
    detectedUnits: safeDetected,
    candidateUnits: safeDetected,
    normalizedLeads: safeNormalized,
    rejectedDuringParsing: Math.max(0, safeDetected - safeNormalized),
    underExtracted: safeDetected >= 5 && ratio < 0.4,
  };
}

function listingToLead(source: CustomSource, listing: ParsedListing): RawLead {
  const url = listing.officialUrl ?? listing.url;
  const sourceId = `custom:${source.slug}` as const;
  const key = slugify(`${source.slug}-${listingKey(listing)}`);
  return {
    id: `custom-${source.slug}-${key}`,
    source: sourceId,
    title: listing.title,
    url,
    text: listing.text,
    links: uniqueUrls([url, listing.listingUrl ?? source.listingUrl], source.listingUrl),
    postedAt: new Date().toISOString(),
    metadata: {
      attribution: sourceId,
      provenance: "custom_site",
      discoveryMode: listing.discoveryMode,
      listingUrl: listing.listingUrl ?? source.listingUrl,
      officialUrl: listing.officialUrl ?? url,
      applyUrl: listing.officialUrl ?? url,
      startDateRaw: listing.startDateRaw,
      location: listing.location,
      format: listing.format,
      prizeSummary: listing.prizeSummary,
      participantsRaw: listing.participantsRaw,
      sponsors: listing.sponsors,
      metadataCompleteness: listing.text.length > 160 ? "partial" : "low",
      reviewReasons: listing.reviewReasons,
      sourceIds: { [sourceId]: normalizeUrlForDedupe(url) },
    },
  };
}

function strategyOverride(source: CustomSource): CustomSourceStrategy {
  return source.selectors.strategy ?? "auto";
}

function headerMatches(header: string, aliases: string[]): boolean {
  const normalized = header.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return aliases.some((alias) => normalized === alias || normalized.includes(alias));
}

function columnIndex(headers: string[], override: string | undefined, aliases: string[]): number {
  if (override) {
    const exact = headers.findIndex((header) => header.trim().toLowerCase() === override.trim().toLowerCase());
    if (exact >= 0) return exact;
  }
  return headers.findIndex((header) => headerMatches(header, aliases));
}

function extractHeaders($: CheerioAPI, table: Cheerio<AnyNode>): string[] {
  const headerCells = table.find("thead th, tr:first-child th, [role='columnheader']").toArray();
  if (headerCells.length === 0) return [];
  return headerCells.map((cell) => cleanText($(cell).text()));
}

function parseTableRows($: CheerioAPI, source: CustomSource, baseUrl: string): ParsedListing[] {
  const out: ParsedListing[] = [];
  for (const tableNode of $("table, [role='table'], [role='grid']").toArray()) {
    const table = $(tableNode);
    const headers = extractHeaders($, table);
    if (headers.length === 0) continue;

    const titleIdx = columnIndex(headers, source.selectors.titleColumn, ["title", "event", "hackathon", "name"]);
    const dateIdx = columnIndex(headers, source.selectors.dateColumn, ["start date", "date", "begins", "event date"]);
    const typeIdx = columnIndex(headers, source.selectors.typeColumn, ["type", "format", "mode"]);
    const urlIdx = columnIndex(headers, source.selectors.urlColumn, ["website", "link", "event page", "url"]);
    const platformIdx = columnIndex(headers, undefined, ["platform", "organizer", "host"]);
    const prizeIdx = columnIndex(headers, undefined, ["prize", "prize pool", "awards"]);
    const participantsIdx = columnIndex(headers, undefined, ["participants", "registrants", "attendees"]);
    const sponsorIdx = columnIndex(headers, undefined, ["sponsors", "sponsor"]);

    const rows = table.find("tbody tr, tr, [role='row']").toArray();
    for (const rowNode of rows) {
      const row = $(rowNode);
      const cells = row.find("td, [role='cell'], [role='gridcell']").toArray();
      if (cells.length < 2) continue;
      const cellText = (index: number) => (index >= 0 ? cleanText($(cells[index]).text()) : "");
      const title = cellText(titleIdx);
      if (!title || title.length > 220) continue;

      const urlCell = urlIdx >= 0 ? $(cells[urlIdx]) : row;
      const href =
        urlCell
          .find("a[href]")
          .toArray()
          .map((link) => normalizeMaybeUrl($(link).attr("href"), baseUrl))
          .find(Boolean) ?? normalizeMaybeUrl(cellText(urlIdx), baseUrl);
      const startDateRaw = cellText(dateIdx);
      const platform = cellText(platformIdx);
      if (!href && !startDateRaw && !platform) continue;

      const format = cellText(typeIdx).toLowerCase();
      const prizeSummary = cellText(prizeIdx);
      const participantsRaw = cellText(participantsIdx);
      const sponsorsRaw = cellText(sponsorIdx);
      const text = [
        title,
        startDateRaw && `Start Date: ${startDateRaw}`,
        format && `Type: ${format}`,
        participantsRaw && `Participants: ${participantsRaw}`,
        prizeSummary && `Prize: ${prizeSummary}`,
        sponsorsRaw && `Sponsors: ${sponsorsRaw}`,
        platform && `Platform: ${platform}`,
      ]
        .filter(Boolean)
        .join(" - ");
      out.push({
        title,
        url: href ?? baseUrl,
        officialUrl: href,
        listingUrl: baseUrl,
        text,
        discoveryMode: "custom_data_table",
        startDateRaw,
        format,
        prizeSummary,
        participantsRaw,
        sponsors: sponsorsRaw && sponsorsRaw !== "-" ? sponsorsRaw.split(/\s*,\s*/).filter(Boolean) : undefined,
        reviewReasons: href ? undefined : ["MISSING_ROW_URL"],
      });
    }
  }
  return out;
}

function parseRepeatedEventSections($: CheerioAPI, source: CustomSource, baseUrl: string): ParsedListing[] {
  const roots = $("#hackathon-items-root > [id^='hackathon-'], .hackathon-item, section[id^='hackathon-']").toArray();
  const out: ParsedListing[] = [];
  for (const rootNode of roots) {
    const root = $(rootNode);
    const title = cleanText(root.find("h1, h2, h3, h4, h5").first().text());
    if (!title || /add a hackathon/i.test(title)) continue;
    const allText = cleanText(root.text());
    if (!DATE_HINT.test(allText) && !EVENT_HINT.test(allText)) continue;

    let officialUrl: string | undefined;
    for (const linkNode of root.find("a[href]").toArray()) {
      const link = $(linkNode);
      const linkText = cleanText(link.text());
      const href = link.attr("href") ?? "";
      if (isDirectionsLink(linkText, href) || /add a hackathon/i.test(linkText)) continue;
      if (/website|official|apply|register/i.test(linkText) || !officialUrl) {
        officialUrl = normalizeMaybeUrl(href, baseUrl);
      }
      if (/website|official|apply|register/i.test(linkText) && officialUrl) break;
    }
    if (!officialUrl) continue;

    const primaryDate = cleanText(root.find(".text-end, time").first().text());
    const startsMatch = allText.match(/\bStarts:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    const locationBlock = cleanText(
      root
        .find(".row .col")
        .toArray()
        .map((node) => cleanText($(node).text()))
        .find((text) => /Starts:/i.test(text)) ?? "",
    );
    const location = cleanText(locationBlock.replace(/\s*Starts:\s*.*$/i, ""));
    const prize = cleanText(root.find("strong").filter((_i, node) => /prizes?/i.test($(node).text())).parent().text());
    const format = cleanText(
      root
        .find(".badge")
        .toArray()
        .map((node) => cleanText($(node).text()))
        .find((text) => /online|in-person|hybrid/i.test(text)) ?? "",
    ).toLowerCase();
    const years = [...new Set((allText.match(/\b20\d{2}\b/g) ?? []))];
    const reviewReasons =
      (primaryDate && startsMatch?.[1] && !datesAgreeLoosely(primaryDate, startsMatch[1])) || years.length > 1
        ? ["DATE_CONFLICT"]
        : undefined;
    out.push({
      title,
      url: officialUrl,
      officialUrl,
      listingUrl: baseUrl,
      text: [title, primaryDate, location, startsMatch?.[0], prize, format].filter(Boolean).join(" - "),
      discoveryMode: "custom_static_event_sections",
      startDateRaw: startsMatch?.[1] ?? primaryDate,
      location,
      format,
      prizeSummary: prize.replace(/^Prizes?:\s*/i, "") || undefined,
      reviewReasons,
    });
  }
  return out;
}

function datesAgreeLoosely(a: string, b: string): boolean {
  const yearA = a.match(/\b(20\d{2})\b/)?.[1];
  const yearB = b.match(/\b(20\d{2})\b/)?.[1];
  if (yearA && yearB && yearA !== yearB) return false;
  return true;
}

function parseCardsFromHtml(
  html: string,
  source: CustomSource,
  baseUrl = source.listingUrl,
): ParsedListing[] {
  const $ = cheerio.load(html);
  const listings: ParsedListing[] = [];
  const selector = source.selectors.cardSelector;
  const roots = selector
    ? $(selector).toArray()
    : $("article, li, .card, [class*='card'], [class*='event'], section").toArray();

  for (const element of roots) {
    const root = $(element);
    const href =
      (source.selectors.linkSelector
        ? root.find(source.selectors.linkSelector).first().attr("href")
        : undefined) ??
      root.find("a[href]").first().attr("href");
    const url = normalizeMaybeUrl(href, baseUrl);
    if (!url) continue;
    const title =
      cleanText(
        source.selectors.titleSelector
          ? root.find(source.selectors.titleSelector).first().text()
          : undefined,
      ) || cleanText(root.find("h1, h2, h3, [class*='title'], a[href]").first().text());
    const text = cleanText(root.text()).slice(0, 2_000);
    if (!title && !EVENT_HINT.test(text)) continue;
    if (!EVENT_HINT.test(`${title} ${text}`) && !DATE_HINT.test(text)) continue;
    listings.push({
      title: title || new URL(url).pathname.replace(/[-_/]+/g, " ").trim() || "Untitled event",
      url,
      officialUrl: url,
      listingUrl: baseUrl,
      text,
      discoveryMode: "custom_card_grid",
    });
  }

  return dedupeListings(listings, source.maxItems);
}

export function extractCustomSourceHtml(
  html: string,
  source: CustomSource,
  baseUrl = source.listingUrl,
): ExtractionResult {
  const $ = cheerio.load(html);
  const tableListings = parseTableRows($, source, baseUrl);
  const sectionListings = parseRepeatedEventSections($, source, baseUrl);
  const cardListings = parseCardsFromHtml(html, source, baseUrl);
  const headers = $("table").first().find("th").toArray().map((node) => cleanText($(node).text()));
  const hiddenCountText = cleanText($("body").text()).match(/\b\d+\s+more\s+upcoming\s+hackathons\s+hidden\b/i)?.[0];
  const tableCount = $("table, [role='table'], [role='grid']").length;
  const dataRowCount = Math.max(0, $("table tbody tr, table tr, [role='row']").length - (headers.length > 0 ? 1 : 0));
  const eventSectionCount = $("#hackathon-items-root > [id^='hackathon-'], .hackathon-item").length;
  const cardCandidateCount = $("article, li, .card, [class*='card'], [class*='event'], section").length;

  const override = strategyOverride(source);
  let strategy: ExtractionStrategy = "card_grid";
  let listings: ParsedListing[] = [];
  if ((override === "auto" || override === "table") && tableListings.length > 0) {
    strategy = "data_table";
    listings = tableListings;
  } else if ((override === "auto" || override === "list") && sectionListings.length > 0) {
    strategy = "repeated_event_sections";
    listings = sectionListings;
  } else if ((override === "auto" || override === "cards") && cardListings.length > 0) {
    strategy = "card_grid";
    listings = cardListings;
  }
  const normalizedListings = dedupeListings(listings, source.maxItems);
  const detectedUnits = Math.max(
    dataRowCount,
    eventSectionCount,
    strategy === "card_grid" ? cardCandidateCount : 0,
    tableListings.length,
    sectionListings.length,
    cardListings.length,
  );
  const quality = extractionQuality(detectedUnits, normalizedListings.length);

  const diagnostics: ExtractionDiagnostics = {
    ...EMPTY_DIAGNOSTICS,
    strategy,
    candidates: tableListings.length + sectionListings.length + cardListings.length,
    valid: normalizedListings.length,
    ...quality,
    tables: tableCount,
    dataRows: dataRowCount,
    eventSections: eventSectionCount,
    cardCandidates: cardCandidateCount,
    headers,
    subscriptionLimited: Boolean(hiddenCountText),
    hiddenCountText,
    parserFailures:
      normalizedListings.length === 0 || quality.underExtracted
        ? [
            quality.underExtracted ? "parser under-extracted visible repeated units" : "",
            tableListings.length === 0 ? "table extraction matched 0 valid rows" : "",
            sectionListings.length === 0 ? "repeated event section extraction matched 0 valid rows" : "",
            cardListings.length === 0 ? "card extraction matched 0 valid rows" : "",
          ].filter(Boolean)
        : [],
  };

  return {
    listings: normalizedListings,
    diagnostics,
  };
}

export function detectCustomPageShape(html: string, source: CustomSource): {
  primaryStrategy: ExtractionStrategy;
  evidence: Pick<ExtractionDiagnostics, "tables" | "dataRows" | "eventSections" | "cardCandidates" | "headers">;
} {
  const extracted = extractCustomSourceHtml(html, source);
  return {
    primaryStrategy: extracted.diagnostics.strategy,
    evidence: {
      tables: extracted.diagnostics.tables,
      dataRows: extracted.diagnostics.dataRows,
      eventSections: extracted.diagnostics.eventSections,
      cardCandidates: extracted.diagnostics.cardCandidates,
      headers: extracted.diagnostics.headers,
    },
  };
}

export function parseCustomSourceHtml(
  html: string,
  source: CustomSource,
  baseUrl = source.listingUrl,
): RawLead[] {
  return extractCustomSourceHtml(html, source, baseUrl).listings.map((listing) => listingToLead(source, listing));
}

async function waitForRenderedRows(page: MinimalPage, timeoutMs: number): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const tables = document.querySelectorAll("table, [role='table'], [role='grid']").length;
        const rows = document.querySelectorAll("tbody tr, tr, [role='row']").length;
        const sections = document.querySelectorAll("#hackathon-items-root > [id^='hackathon-'], .hackathon-item").length;
        return tables > 0 || rows > 2 || sections > 0 || document.body.innerText.length > 500;
      },
      undefined,
      { timeout: Math.min(timeoutMs, CUSTOM_PAGE_TIMEOUT_MS) },
    )
    .catch(() => undefined);
  await page.waitForTimeout(500);
}

async function rowFingerprint(page: Pick<MinimalPage, "evaluate">): Promise<string> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("tbody tr, tr, [role='row']"))
      .slice(0, 5)
      .map((row) => (row.textContent ?? "").replace(/\s+/g, " ").trim())
      .join("|"),
  );
}

async function clickNextPage(page: Pick<MinimalPage, "evaluate">): Promise<boolean> {
  return page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll("button, a")) as Array<HTMLButtonElement | HTMLAnchorElement>;
    const next = controls.find((control) => {
      const label = `${control.getAttribute("aria-label") ?? ""} ${control.textContent ?? ""}`.trim();
      const disabled =
        control.hasAttribute("disabled") ||
        control.getAttribute("aria-disabled") === "true";
      return !disabled && /go to next page|next page/i.test(label);
    });
    if (!next) return false;
    next.click();
    return true;
  });
}

async function collectRenderedListings(source: CustomSource, timeoutMs: number, logger?: (message: string) => void): Promise<RenderedCollection> {
  return withPlaywright(
    async ({ page }) => {
      await assertSafeCustomSourceUrl(source.listingUrl);
      logger?.(`[custom:${source.slug}] Opening database`);
      await page.goto(source.listingUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await waitForRenderedRows(page, timeoutMs);
      await assertSafeCustomSourceUrl(page.url());

      const allListings: ParsedListing[] = [];
      let diagnostics: ExtractionDiagnostics = { ...EMPTY_DIAGNOSTICS };
      let pagesVisited = 0;
      let noGrowth = 0;
      let stopReason = "final_page";

      for (let pageNumber = 1; pageNumber <= CUSTOM_MAX_PAGES; pageNumber += 1) {
        pagesVisited = pageNumber;
        const beforeCount = dedupeListings(allListings, source.maxItems).length;
        const html = await page.content();
        const extracted = extractCustomSourceHtml(html, source, page.url());
        diagnostics = extracted.diagnostics;
        allListings.push(...extracted.listings);
        const unique = dedupeListings(allListings, source.maxItems);
        const newCount = unique.length - beforeCount;
        logger?.(`[custom:${source.slug}] Page ${pageNumber}: ${extracted.listings.length} rows - ${Math.max(0, newCount)} new`);
        if (unique.length >= source.maxItems) {
          stopReason = "maximum_items";
          break;
        }
        if (newCount <= 0) noGrowth += 1;
        else noGrowth = 0;
        if (noGrowth >= CUSTOM_PAGE_NO_GROWTH_LIMIT) {
          stopReason = "no_new_rows";
          break;
        }

        const previousFingerprint = await rowFingerprint(page);
        const clicked = await clickNextPage(page);
        if (!clicked) {
          stopReason = "final_page";
          break;
        }
        logger?.(`[custom:${source.slug}] Following Next`);
        await page
          .waitForFunction(
            (previous: string) =>
              Array.from(document.querySelectorAll("tbody tr, tr, [role='row']"))
                .slice(0, 5)
                .map((row) => (row.textContent ?? "").replace(/\s+/g, " ").trim())
                .join("|") !== previous,
            previousFingerprint,
            { timeout: CUSTOM_PAGE_TIMEOUT_MS },
          )
          .catch(() => {
            stopReason = "page_fingerprint_unchanged";
          });
        await page.waitForTimeout(500);
        if (stopReason === "page_fingerprint_unchanged") break;
      }

      return {
        listings: dedupeListings(allListings, source.maxItems),
        diagnostics,
        pagesVisited,
        stopReason,
      };
    },
    { timeoutMs },
  );
}

async function enrichDetails(source: CustomSource, leads: RawLead[], timeoutMs: number): Promise<RawLead[]> {
  const details = leads.slice(0, Math.min(DETAIL_LIMIT, leads.length));
  await Promise.all(
    details.map(async (lead) => {
      if (!lead.url) return;
      try {
        await assertSafeCustomSourceUrl(lead.url);
        const html = await fetchHtml(lead.url, {
          timeoutMs: Math.min(timeoutMs, 5_000),
          retries: 0,
          validateUrl: (url) => assertSafeCustomSourceUrl(url),
        });
        const $ = cheerio.load(html);
        const description =
          $("meta[name='description']").attr("content")?.trim() ||
          $("p").first().text().replace(/\s+/g, " ").trim();
        const title = $("h1").first().text().trim() || $("title").text().trim();
        lead.title = title || lead.title;
        lead.text = [lead.text, description].filter(Boolean).join(" - ").slice(0, 3_000);
        lead.links = uniqueUrls(
          [
            ...lead.links,
            ...$("a[href]")
              .map((_i, node) => $(node).attr("href") ?? "")
              .get()
              .slice(0, 20),
          ],
          lead.url,
        );
      } catch {
        // Detail failures do not remove a plausible listing lead.
      }
    }),
  );
  return leads;
}

function shouldTryPlaywrightFallback(html: string): boolean {
  return /__NEXT_DATA__|<script|loading|skeleton|data-reactroot|app-root|root/i.test(html);
}

function isTimeoutMessage(message: string): boolean {
  return /timed out|timeout|AbortError/i.test(message);
}

function qualityMessage(source: CustomSource, diagnostics: ExtractionDiagnostics): string {
  if (diagnostics.underExtracted) {
    return `[custom:${source.slug}] Parser under-extracted the directory`;
  }
  if (diagnostics.detectedUnits >= 5 && diagnostics.normalizedLeads === 0) {
    return `[custom:${source.slug}] Parser failed to normalize visible rows`;
  }
  return `[custom:${source.slug}] Extraction completed`;
}

export async function collectCustomSource(
  source: CustomSource,
  options: {
    timeoutMs?: number;
    logger?: (message: string) => void;
    persistHealth?: boolean;
  } = {},
): Promise<CollectorResult> {
  const startedAt = Date.now();
  const customId = `custom:${source.slug}` as const;
  const result = emptyCollectorResult(customId, startedAt);
  const requestedTimeoutMs = options.timeoutMs ?? 20_000;
  const mode = source.mode;
  options.logger?.(`[custom:${source.slug}] Starting ${mode} discovery...`);

  if (!source.enabled) {
    result.status = "failed";
    result.warnings.push("Custom source disabled");
    return result;
  }

  try {
    await assertSafeCustomSourceUrl(source.listingUrl);
    let extracted: ExtractionResult | RenderedCollection;
    let usedPlaywright = false;

    if (mode === "playwright") {
      usedPlaywright = true;
      extracted = await collectRenderedListings(source, Math.min(requestedTimeoutMs, PLAYWRIGHT_CHECK_TIMEOUT_MS), options.logger);
    } else {
      options.logger?.(`[custom:${source.slug}] Static HTML loading...`);
      const html = await fetchHtml(source.listingUrl, {
        timeoutMs: Math.min(requestedTimeoutMs, STATIC_CHECK_TIMEOUT_MS),
        retries: 1,
        validateUrl: (url) => assertSafeCustomSourceUrl(url),
      });
      options.logger?.(`[custom:${source.slug}] Static HTML loaded`);
      extracted = extractCustomSourceHtml(html, source);
      if (
        mode === "auto" &&
        shouldTryPlaywrightFallback(html) &&
        (extracted.listings.length === 0 || extracted.diagnostics.underExtracted)
      ) {
        options.logger?.(
          extracted.diagnostics.underExtracted
            ? `[custom:${source.slug}] Static parser under-extracted visible units`
            : `[custom:${source.slug}] Static parser found 0 usable events`,
        );
        options.logger?.(`[custom:${source.slug}] Trying Playwright fallback...`);
        usedPlaywright = true;
        extracted = await collectRenderedListings(source, Math.min(requestedTimeoutMs, PLAYWRIGHT_CHECK_TIMEOUT_MS), options.logger);
      }
    }

    options.logger?.(`[custom:${source.slug}] Shape: ${extracted.diagnostics.strategy.replace(/_/g, " ")}`);
    options.logger?.(`[custom:${source.slug}] ${extracted.diagnostics.detectedUnits} visible rows`);
    options.logger?.(`[custom:${source.slug}] ${extracted.diagnostics.normalizedLeads} rows normalized`);
    if (extracted.diagnostics.tables > 0) {
      options.logger?.(`[custom:${source.slug}] ${extracted.diagnostics.tables} data table detected`);
    }
    if (extracted.diagnostics.eventSections > 0) {
      options.logger?.(`[custom:${source.slug}] ${extracted.diagnostics.eventSections} event-like sections detected`);
    }
    if (extracted.diagnostics.underExtracted) {
      options.logger?.(qualityMessage(source, extracted.diagnostics));
    }

    if (extracted.listings.length === 0) {
      result.status = "degraded";
      const message =
        mode === "static" && extracted.diagnostics.tables === 0 && extracted.diagnostics.eventSections === 0
          ? "Static HTML contains no event rows; use --mode=playwright if the page is client-rendered"
          : `Page loaded, but the ${extracted.diagnostics.strategy} parser could not identify public events`;
      result.warnings.push(message);
      result.diagnostics = {
        discovered: extracted.diagnostics.candidates,
        returned: 0,
        enriched: 0,
        partial: 0,
        dropped: extracted.diagnostics.candidates,
        detectedUnits: extracted.diagnostics.detectedUnits,
        candidateUnits: extracted.diagnostics.candidateUnits,
        normalizedLeads: extracted.diagnostics.normalizedLeads,
        rejectedDuringParsing: extracted.diagnostics.rejectedDuringParsing,
        pagesTraversed: "pagesVisited" in extracted ? extracted.pagesVisited : 1,
        extractionStrategy: extracted.diagnostics.strategy,
        stopReason: "parser_failure",
        safeMessage: message,
      };
      if (options.persistHealth) {
        await updateCustomSourceHealth(source.slug, {
          status: "degraded",
          lastErrorSafe: message,
        }).catch(() => undefined);
      }
      return result;
    }

    let leads = extracted.listings.slice(0, source.maxItems).map((listing) => listingToLead(source, listing));
    if (usedPlaywright || extracted.diagnostics.strategy === "data_table" || extracted.diagnostics.strategy === "repeated_event_sections") {
      // Listing rows usually already contain the canonical public URL; avoid detail fan-out.
    } else {
      leads = await enrichDetails(source, leads, requestedTimeoutMs);
    }
    result.leads = leads;
    result.status = extracted.diagnostics.underExtracted ? "degraded" : "completed";
    if (extracted.diagnostics.underExtracted) {
      result.warnings.push("Parser under-extracted the directory");
    }
    const pagesVisited = "pagesVisited" in extracted ? extracted.pagesVisited : 1;
    result.metrics = {
      pagesFetched: pagesVisited,
      leadsEmitted: result.leads.length,
      uniqueRows: extracted.listings.length,
      tables: extracted.diagnostics.tables,
      eventSections: extracted.diagnostics.eventSections,
      detailPagesOpened:
        usedPlaywright || extracted.diagnostics.strategy === "data_table" || extracted.diagnostics.strategy === "repeated_event_sections"
          ? 0
          : Math.min(DETAIL_LIMIT, result.leads.length),
    };
    result.diagnostics = {
      discovered: extracted.diagnostics.candidates || extracted.listings.length,
      returned: result.leads.length,
      enriched: result.metrics.detailPagesOpened,
      partial: result.leads.filter((lead) => (lead.metadata?.reviewReasons as unknown[] | undefined)?.length).length,
      dropped: Math.max(0, extracted.diagnostics.candidates - result.leads.length),
      detectedUnits: extracted.diagnostics.detectedUnits,
      candidateUnits: extracted.diagnostics.candidateUnits,
      normalizedLeads: extracted.diagnostics.normalizedLeads,
      rejectedDuringParsing: extracted.diagnostics.rejectedDuringParsing,
      pagesTraversed: pagesVisited,
      extractionStrategy: extracted.diagnostics.strategy,
      stopReason: extracted.diagnostics.underExtracted
        ? "under_extraction"
        : "stopReason" in extracted ? extracted.stopReason : undefined,
      safeMessage: extracted.diagnostics.subscriptionLimited
        ? "Additional subscription-limited rows were not accessed"
        : extracted.diagnostics.underExtracted
          ? "Parser under-extracted the directory"
        : undefined,
    };
    options.logger?.(`[custom:${source.slug}] ${result.leads.length} public leads extractable`);
    if (extracted.diagnostics.subscriptionLimited) {
      options.logger?.(`[custom:${source.slug}] Additional subscription-limited rows were not accessed`);
    }
    if (options.persistHealth) {
      await updateCustomSourceHealth(source.slug, {
        status: result.status === "degraded" ? "degraded" : "healthy",
        lastErrorSafe: result.status === "degraded"
          ? "Parser under-extracted the directory"
          : null,
      }).catch(() => undefined);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Custom source collection failed";
    result.status = isTimeoutMessage(message) ? "degraded" : "failed";
    result.errors.push(message);
    result.diagnostics = {
      ...result.diagnostics,
      safeMessage: isTimeoutMessage(message)
        ? `Check timed out while fetching the page`
        : "Custom source collection failed",
      stopReason: isTimeoutMessage(message) ? "timeout" : "error",
    };
    if (options.persistHealth) {
      await updateCustomSourceHealth(source.slug, {
        status: result.status === "degraded" ? "degraded" : "failed",
        lastErrorSafe: message.slice(0, 500),
      }).catch(() => undefined);
    }
  } finally {
    result.durationMs = Date.now() - startedAt;
  }

  return result;
}

export async function checkCustomSource(
  source: CustomSource,
  options: { logger?: (message: string) => void } = {},
): Promise<CollectorResult> {
  const timeoutMs = source.mode === "static" ? STATIC_CHECK_TIMEOUT_MS : PLAYWRIGHT_CHECK_TIMEOUT_MS;
  return collectCustomSource(source, { timeoutMs, persistHealth: true, logger: options.logger });
}
