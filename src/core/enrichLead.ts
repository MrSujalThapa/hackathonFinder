import { lookup } from "node:dns/promises";
import * as cheerio from "cheerio";
import type { RawLead } from "@/core/discovery/types";
import {
  isXSocialUrl,
  pickBestOfficialUrlForXLead,
  resolveXSocialUrl,
  softSearchOfficialUrlForXLead,
} from "@/core/xLeadVerify";
import { FetchHtmlError, fetchHtml } from "@/lib/http/fetchHtml";
import { normalizeUrl, uniqueUrls } from "@/lib/http/url";
import { createSearchProviderOptional } from "@/lib/search/createSearchProvider";
import type { SearchProvider } from "@/lib/search/types";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1_500_000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_PAGES = 15;

const PRIVATE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
const DNS_LOOKUP_TIMEOUT_MS = 1_500;

export type EnrichLeadOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  concurrency?: number;
  maxPages?: number;
  fetchImpl?: typeof fetchHtml;
  /**
   * Optional web search for linkless X posts.
   * - undefined: try createSearchProviderOptional() (no crash if missing)
   * - null: disable soft search
   * - provider: use injected provider (tests)
   */
  searchProvider?: SearchProvider | null;
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

type DnsLookup = (hostname: string) => Promise<Array<{ address: string }>>;

async function lookupWithTimeout(hostname: string, dnsLookup: DnsLookup): Promise<Array<{ address: string }>> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      dnsLookup(hostname),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new UnsafeUrlError(`DNS lookup timed out for host: ${hostname}`));
        }, DNS_LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function assertSafePublicHttpUrlWithDns(
  rawUrl: string,
  options: { lookup?: DnsLookup } = {},
): Promise<URL> {
  const parsed = assertSafePublicHttpUrl(rawUrl);
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const dnsLookup = options.lookup ?? ((hostname: string) => lookup(hostname, { all: true }));

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookupWithTimeout(host, dnsLookup);
  } catch (error) {
    if (error instanceof UnsafeUrlError) throw error;
    throw new UnsafeUrlError(`DNS lookup failed for host: ${host}`);
  }

  for (const { address } of addresses) {
    const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
    if (normalized.includes(":") || isPrivateIpv4(normalized) || PRIVATE_HOSTS.has(normalized)) {
      throw new UnsafeUrlError(`Private or non-public resolved address blocked: ${host}`);
    }
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

/**
 * Parse structured fields from fetched HTML.
 * Page text is untrusted data — extracted as plain strings only; never executed
 * or interpreted as instructions / tool-policy changes.
 */
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

/**
 * Choose the URL to fetch for enrichment.
 * For X leads: never fetch the post URL; only outbound official/apply candidates.
 */
export function resolveEnrichmentTarget(lead: RawLead): string | undefined {
  if (lead.source === "x") {
    return pickBestOfficialUrlForXLead(lead);
  }
  return lead.url ?? (typeof lead.metadata?.officialUrl === "string" ? lead.metadata.officialUrl : undefined);
}

function resolveOptionalSearchProvider(
  options: EnrichLeadOptions,
): SearchProvider | null {
  if (options.searchProvider !== undefined) {
    return options.searchProvider;
  }
  try {
    return createSearchProviderOptional();
  } catch {
    return null;
  }
}

async function prepareLeadForEnrichment(
  lead: RawLead,
  options: EnrichLeadOptions,
): Promise<RawLead> {
  if (lead.source !== "x") return lead;

  const socialUrl = resolveXSocialUrl(lead);
  const existingTarget = pickBestOfficialUrlForXLead(lead);
  if (existingTarget) {
    return {
      ...lead,
      metadata: {
        ...(lead.metadata ?? {}),
        ...(socialUrl ? { socialUrl } : {}),
        // Prefer outbound official; never leave the post as officialUrl.
        officialUrl: existingTarget,
      },
    };
  }

  const soft = await softSearchOfficialUrlForXLead(lead, {
    searchProvider: resolveOptionalSearchProvider(options),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  if (!soft) {
    const metadata: Record<string, unknown> = {
      ...(lead.metadata ?? {}),
      ...(socialUrl ? { socialUrl } : {}),
    };
    // Never keep the X post URL as officialUrl.
    if (typeof metadata.officialUrl === "string" && isXSocialUrl(metadata.officialUrl)) {
      delete metadata.officialUrl;
    }
    return { ...lead, metadata };
  }

  return {
    ...lead,
    links: uniqueUrls([...(lead.links ?? []), soft]),
    metadata: {
      ...(lead.metadata ?? {}),
      ...(socialUrl ? { socialUrl } : {}),
      officialUrl: soft,
      softSearchOfficial: true,
    },
  };
}

async function enrichOne(
  lead: RawLead,
  options: Required<Pick<EnrichLeadOptions, "timeoutMs" | "maxBytes">> & {
    fetchImpl: typeof fetchHtml;
    validateUrl: (url: string) => unknown | Promise<unknown>;
  },
): Promise<RawLead> {
  const target = resolveEnrichmentTarget(lead);
  if (!target) return lead;

  assertSafePublicHttpUrl(target);
  const html = await options.fetchImpl(target, {
    timeoutMs: options.timeoutMs,
    retries: 0,
    maxBytes: options.maxBytes,
    validateUrl: options.validateUrl,
  });

  if (html.length > options.maxBytes) {
    throw new FetchHtmlError(`Response too large (>${options.maxBytes} bytes)`, target);
  }

  // Untrusted HTML: parseEnrichedPage extracts fields only; no instruction execution.
  const parsed = parseEnrichedPage(html, target);
  const socialUrl = lead.source === "x" ? resolveXSocialUrl(lead) : undefined;

  const metadata = {
    ...(lead.metadata ?? {}),
    ...parsed,
    // Preserve original search / social evidence
    snippet: lead.metadata?.snippet ?? lead.text,
    query: lead.metadata?.query,
    enrichedFrom: target,
    // X: official page is the enriched target; post stays on socialUrl.
    ...(lead.source === "x"
      ? {
          officialUrl: target,
          ...(socialUrl ? { socialUrl } : {}),
        }
      : {}),
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
 * Bounded enrichment for promising web/Luma/X leads.
 * Failures are isolated; original leads are returned unchanged on error.
 * X posts are never fetched as official pages — only outbound non-social URLs.
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
  const validateUrl = options.fetchImpl
    ? (url: string) => assertSafePublicHttpUrl(url)
    : (url: string) => assertSafePublicHttpUrlWithDns(url);
  const warnings: string[] = [];

  // Prepare X leads (soft search for linkless when available) without crashing.
  const prepared: RawLead[] = [];
  for (const lead of leads) {
    try {
      prepared.push(await prepareLeadForEnrichment(lead, options));
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? `X prepare skipped for ${lead.id}: ${error.message}`
          : `X prepare skipped for ${lead.id}`,
      );
      prepared.push(lead);
    }
  }

  const candidates = prepared
    .filter((lead) => lead.source === "web" || lead.source === "luma" || lead.source === "x")
    .filter((lead) => Boolean(resolveEnrichmentTarget(lead)))
    .slice(0, maxPages);

  if (candidates.length === 0) {
    return { leads: prepared, enrichedCount: 0, warnings };
  }

  const enrichedById = new Map<string, RawLead>();
  /** In-run cache: one fetch per canonical enrichment URL. */
  const byTargetUrl = new Map<string, Promise<RawLead>>();
  let enrichedCount = 0;

  await mapPool(candidates, concurrency, async (lead) => {
    const target = resolveEnrichmentTarget(lead);
    if (!target) return;
    try {
      let shared = byTargetUrl.get(target);
      if (!shared) {
        shared = enrichOne(lead, { timeoutMs, maxBytes, fetchImpl, validateUrl });
        byTargetUrl.set(target, shared);
      }
      const fetched = await shared;
      const enriched =
        fetched.id === lead.id
          ? fetched
          : {
              ...lead,
              title: fetched.title || lead.title,
              text: [lead.text, fetched.metadata?.description]
                .filter(Boolean)
                .join(" — "),
              links: uniqueUrls([...(lead.links ?? []), ...(fetched.links ?? [])], target),
              metadata: {
                ...(lead.metadata ?? {}),
                ...(fetched.metadata ?? {}),
                enrichedFrom: target,
              },
            };
      enrichedById.set(lead.id, enriched);
      enrichedCount += 1;
    } catch (error) {
      byTargetUrl.delete(target);
      warnings.push(
        error instanceof Error
          ? `Enrichment skipped for ${lead.url ?? lead.id}: ${error.message}`
          : `Enrichment skipped for ${lead.id}`,
      );
    }
  });

  const merged = prepared.map((lead) => enrichedById.get(lead.id) ?? lead);
  return { leads: merged, enrichedCount, warnings };
}
