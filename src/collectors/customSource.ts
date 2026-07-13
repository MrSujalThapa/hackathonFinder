import * as cheerio from "cheerio";
import type { RawLead } from "@/core/discovery/types";
import { emptyCollectorResult, type CollectorResult } from "@/collectors/types";
import type { CustomSource } from "@/server/customSources/types";
import { fetchHtml } from "@/lib/http/fetchHtml";
import { normalizeUrl, normalizeUrlForDedupe, slugify, uniqueUrls } from "@/lib/http/url";
import { withPlaywright } from "@/lib/browser/playwright";
import { collectUntilStable } from "@/lib/browser/collectUntilStable";
import { updateCustomSourceHealth } from "@/server/customSources/repository";
import { assertSafeCustomSourceUrl } from "@/server/customSources/urlSafety";

const EVENT_HINT =
  /\b(event|hackathon|challenge|competition|buildathon|codefest|workshop|summit|meetup|demo day|registration)\b/i;
const DATE_HINT =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/i;
const MAX_SCROLLS = 8;
const WAIT_MS = 900;
const DETAIL_LIMIT = 10;

type ParsedCard = {
  title: string;
  url: string;
  text: string;
};

function cardToLead(source: CustomSource, card: ParsedCard): RawLead {
  const key = slugify(`${source.slug}-${card.url}`);
  return {
    id: `custom-${source.slug}-${key}`,
    source: "web",
    title: card.title,
    url: card.url,
    text: card.text,
    links: [card.url],
    postedAt: new Date().toISOString(),
    metadata: {
      attribution: `custom:${source.slug}`,
      provenance: "custom_site",
      discoveryMode: `custom:${source.slug}`,
      officialUrl: card.url,
      applyUrl: card.url,
      sourceIds: { [`custom:${source.slug}`]: normalizeUrlForDedupe(card.url) },
    },
  };
}

function parseCardsFromHtml(
  html: string,
  source: CustomSource,
  baseUrl = source.listingUrl,
): ParsedCard[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const cards: ParsedCard[] = [];
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
    if (!href) continue;
    const url = normalizeUrl(href, baseUrl);
    if (!url) continue;
    const title =
      (source.selectors.titleSelector
        ? root.find(source.selectors.titleSelector).first().text().trim()
        : undefined) ??
      root.find("h1, h2, h3, [class*='title'], a[href]").first().text().trim() ??
      "";
    const text = root.text().replace(/\s+/g, " ").trim().slice(0, 2_000);
    if (!title && !EVENT_HINT.test(text)) continue;
    if (!EVENT_HINT.test(`${title} ${text}`) && !DATE_HINT.test(text)) continue;
    const key = normalizeUrlForDedupe(url);
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({
      title: title || new URL(url).pathname.replace(/[-_/]+/g, " ").trim() || "Untitled event",
      url,
      text,
    });
    if (cards.length >= source.maxItems) break;
  }

  return cards;
}

export function parseCustomSourceHtml(
  html: string,
  source: CustomSource,
  baseUrl = source.listingUrl,
): RawLead[] {
  return parseCardsFromHtml(html, source, baseUrl)
    .slice(0, source.maxItems)
    .map((card) => cardToLead(source, card));
}

async function collectRenderedCards(source: CustomSource, timeoutMs: number): Promise<{
  cards: ParsedCard[];
  scrolls: number;
  stopReason: string;
}> {
  return withPlaywright(
    async ({ page }) => {
      await page.goto(source.listingUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForTimeout(500);
      const collected = await collectUntilStable<ParsedCard>({
        collectItems: async () => parseCardsFromHtml(await page.content(), source, page.url()),
        getKey: (card) => normalizeUrlForDedupe(card.url),
        scroll: async () => {
          await page.mouse.wheel(0, 2_000);
        },
        waitForIdle: async () => {
          await page.waitForLoadState("networkidle", { timeout: WAIT_MS }).catch(() => undefined);
        },
        maxItems: source.maxItems,
        maxScrolls: MAX_SCROLLS,
        noGrowthLimit: 2,
        timeoutMs,
        waitMs: WAIT_MS,
      });
      return {
        cards: collected.items,
        scrolls: collected.scrollAttempts,
        stopReason: collected.stopReason,
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
        const html = await fetchHtml(lead.url, { timeoutMs: Math.min(timeoutMs, 5_000), retries: 0 });
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

export async function collectCustomSource(
  source: CustomSource,
  options: {
    timeoutMs?: number;
    logger?: (message: string) => void;
    persistHealth?: boolean;
  } = {},
): Promise<CollectorResult> {
  const startedAt = Date.now();
  const result = emptyCollectorResult("web", startedAt);
  const timeoutMs = options.timeoutMs ?? 20_000;
  options.logger?.(`[custom:${source.slug}] Opening listing page...`);

  if (!source.enabled) {
    result.status = "failed";
    result.warnings.push("Custom source disabled");
    return result;
  }

  try {
    await assertSafeCustomSourceUrl(source.listingUrl);
    const cards =
      source.mode === "playwright"
        ? (await collectRenderedCards(source, timeoutMs)).cards
        : parseCardsFromHtml(await fetchHtml(source.listingUrl, { timeoutMs, retries: 1 }), source);

    options.logger?.(`[custom:${source.slug}] ${cards.length} event-like cards found`);

    if (cards.length === 0) {
      result.status = "degraded";
      result.warnings.push("Page loaded, but the generic parser could not identify event cards");
      if (options.persistHealth) {
        await updateCustomSourceHealth(source.slug, {
          status: "degraded",
          lastErrorSafe: "Page loaded, but the generic parser could not identify event cards",
        }).catch(() => undefined);
      }
      return result;
    }

    result.leads = await enrichDetails(
      source,
      cards.slice(0, source.maxItems).map((card) => cardToLead(source, card)),
      timeoutMs,
    );
    result.status = "completed";
    result.metrics = {
      pagesFetched: 1,
      leadsEmitted: result.leads.length,
      uniqueCards: cards.length,
      detailPagesOpened: Math.min(DETAIL_LIMIT, result.leads.length),
    };
    result.diagnostics = {
      discovered: cards.length,
      returned: result.leads.length,
      enriched: Math.min(DETAIL_LIMIT, result.leads.length),
      partial: 0,
      dropped: Math.max(0, cards.length - result.leads.length),
    };
    options.logger?.(`[custom:${source.slug}] Returning ${result.leads.length} leads`);
    if (options.persistHealth) {
      await updateCustomSourceHealth(source.slug, {
        status: "healthy",
        lastErrorSafe: null,
      }).catch(() => undefined);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Custom source collection failed";
    result.status = "failed";
    result.errors.push(message);
    if (options.persistHealth) {
      await updateCustomSourceHealth(source.slug, {
        status: "failed",
        lastErrorSafe: message.slice(0, 500),
      }).catch(() => undefined);
    }
  } finally {
    result.durationMs = Date.now() - startedAt;
  }

  return result;
}

export async function checkCustomSource(source: CustomSource): Promise<CollectorResult> {
  return collectCustomSource(source, { timeoutMs: 15_000, persistHealth: true });
}
