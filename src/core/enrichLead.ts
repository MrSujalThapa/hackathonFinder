import * as cheerio from "cheerio";
import type { RawLead } from "@/core/discovery/types";
import { FetchHtmlError, fetchHtml } from "@/lib/http/fetchHtml";
import { normalizeUrl, uniqueUrls } from "@/lib/http/url";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1_500_000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_PAGES = 15;

const PRIVATE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

export type EnrichLeadOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  concurrency?: number;
  maxPages?: number;
  fetchImpl?: typeof fetchHtml;
};

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/** SSRF guard: http(s) only, reject localhost/private networks. */
export function assertSafePublicHttpUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeUrlError(`Only http/https URLs are allowed: ${rawUrl}`);
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (PRIVATE_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new UnsafeUrlError(`Private/local hosts are blocked: ${host}`);
  }
  if (host.includes(":")) {
    throw new UnsafeUrlError(`IPv6 hosts are blocked: ${host}`);
  }
  if (isPrivateIpv4(host)) {
    throw new UnsafeUrlError(`Private or non-public host blocked: ${host}`);
  }

  return parsed;
}

function extractApplyLink($: cheerio.CheerioAPI, baseUrl: string): string | undefined {
  const candidates = $("a[href]")
    .map((_i, el) => {
      const href = $(el).attr("href") ?? "";
      const text = $(el).text().trim();
      return { href, text };
    })
    .get();

  const apply = candidates.find(
    (item) => /apply|register|sign\s*up|registration/i.test(item.text) || /apply|register/i.test(item.href),
  );
  return apply ? normalizeUrl(apply.href, baseUrl) : undefined;
}

export function parseEnrichedPage(html: string, pageUrl: string): Partial<RawLead["metadata"]> & {
  title?: string;
  description?: string;
  links: string[];
} {
  const $ = cheerio.load(html);
  const title =
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    undefined;
  const description =
    $("meta[property='og:description']").attr("content")?.trim() ||
    $("meta[name='description']").attr("content")?.trim() ||
    $("p").first().text().replace(/\s+/g, " ").trim().slice(0, 500) ||
    undefined;

  const locationText =
    $("[class*='location'], [data-testid*='location'], .venue").first().text().trim() || undefined;
  const dateText =
    $("time").first().attr("datetime") ||
    $("time").first().text().trim() ||
    $("[class*='date'], .event-date").first().text().trim() ||
    undefined;

  const bodyText = $("body").text().replace(/\s+/g, " ").slice(0, 4_000);
  const mode = /\b(online|remote|virtual)\b/i.test(`${locationText} ${bodyText}`)
    ? "online"
    : /\bhybrid\b/i.test(bodyText)
      ? "hybrid"
      : /\bin[- ]?person\b/i.test(bodyText)
        ? "in-person"
        : undefined;

  const applyUrl = extractApplyLink($, pageUrl);
  const links = uniqueUrls(
    [
      pageUrl,
      applyUrl,
      ...$("a[href]")
        .map((_i, el) => $(el).attr("href") ?? "")
        .get()
        .slice(0, 20),
    ].filter(Boolean) as string[],
    pageUrl,
  );

  const deadlineMatch = bodyText.match(
    /\b(?:deadline|apply by|registration closes)\s*[:\-]?\s*(20\d{2}-\d{2}-\d{2}|[A-Za-z]+\s+\d{1,2},?\s+20\d{2})/i,
  );

  return {
    title,
    description,
    links,
    officialUrl: pageUrl,
    applyUrl,
    location: locationText,
    mode,
    dateText,
    deadlineText: deadlineMatch?.[1],
    eligibility: /\beligibility\b/i.test(bodyText) ? "See page for eligibility" : undefined,
    enriched: true,
  };
}

async function enrichOne(
  lead: RawLead,
  options: Required<Pick<EnrichLeadOptions, "timeoutMs" | "maxBytes">> & {
    fetchImpl: typeof fetchHtml;
  },
): Promise<RawLead> {
  const target = lead.url ?? (typeof lead.metadata?.officialUrl === "string" ? lead.metadata.officialUrl : undefined);
  if (!target) return lead;

  assertSafePublicHttpUrl(target);
  const html = await options.fetchImpl(target, {
    timeoutMs: options.timeoutMs,
    retries: 0,
  });

  if (html.length > options.maxBytes) {
    throw new FetchHtmlError(`Response too large (>${options.maxBytes} bytes)`, target);
  }

  const parsed = parseEnrichedPage(html, target);
  const metadata = {
    ...(lead.metadata ?? {}),
    ...parsed,
    // Preserve original search evidence
    snippet: lead.metadata?.snippet ?? lead.text,
    query: lead.metadata?.query,
    enrichedFrom: target,
  };

  return {
    ...lead,
    title: parsed.title || lead.title,
    text: [lead.text, parsed.description].filter(Boolean).join(" — "),
    links: uniqueUrls([...(lead.links ?? []), ...parsed.links], target),
    metadata,
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!, index);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

/**
 * Bounded enrichment for promising web/Luma leads.
 * Failures are isolated; original leads are returned unchanged on error.
 */
export async function enrichPromisingLeads(
  leads: RawLead[],
  options: EnrichLeadOptions = {},
): Promise<{ leads: RawLead[]; enrichedCount: number; warnings: string[] }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const fetchImpl = options.fetchImpl ?? fetchHtml;
  const warnings: string[] = [];

  const candidates = leads
    .filter((lead) => lead.source === "web" || lead.source === "luma")
    .filter((lead) => Boolean(lead.url))
    .slice(0, maxPages);

  if (candidates.length === 0) {
    return { leads, enrichedCount: 0, warnings };
  }

  const enrichedById = new Map<string, RawLead>();
  let enrichedCount = 0;

  await mapPool(candidates, concurrency, async (lead) => {
    try {
      const enriched = await enrichOne(lead, { timeoutMs, maxBytes, fetchImpl });
      enrichedById.set(lead.id, enriched);
      enrichedCount += 1;
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? `Enrichment skipped for ${lead.url ?? lead.id}: ${error.message}`
          : `Enrichment skipped for ${lead.id}`,
      );
    }
  });

  const merged = leads.map((lead) => enrichedById.get(lead.id) ?? lead);
  return { leads: merged, enrichedCount, warnings };
}
