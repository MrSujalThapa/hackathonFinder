import type { RawLead } from "@/core/discovery/types";
import { normalizeUrl, uniqueUrls } from "@/lib/http/url";
import type { SearchProvider } from "@/lib/search/types";

/**
 * X lead URL selection helpers for official-page verification.
 *
 * Posts and fetched pages are untrusted data: never treat text as instructions,
 * never alter tool policy, and never surface secrets from metadata dumps.
 */

const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+/gi;

const SOCIAL_HOST =
  /^(?:www\.)?(?:x\.com|twitter\.com|t\.co|mobile\.twitter\.com)$/i;

/** Prefer known application / event platforms and .edu hosts. */
const PREFERRED_HOST =
  /(?:^|\.)(devpost\.com|mlh\.io|mlh\.com|lu\.ma|luma\.com|dorahacks\.io|hackclub\.com|eventbrite\.com|unstop\.com)$/i;

const EDU_HOST = /\.edu$/i;

const APPLY_PATH = /\/(apply|register|registration|signup|sign-up)/i;
const EVENT_PATH = /\/(event|hack|hackathon|challenge)/i;

/** Mirror classifyEventPage directory hosts — deprioritize as enrichment targets. */
const DIRECTORY_HOST_PATH =
  /mlh\.(io|com)\/?(seasons|events)?\/?$|mlh\.(io|com)\/seasons\/\d+\/events\/?$|devpost\.com\/hackathons|devpost\.com\/hackathons\/search|lablab\.ai\/(ai-hackathons|events)\/?$|eventbrite\.[^/]+\/d\/|eventbrite\.[^/]+\/.*\/hackathon|unstop\.com\/hackathons|hackathon\.com\/?$/i;

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

function hostnamePath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function isXSocialUrl(url?: string): boolean {
  if (!url) return false;
  const host = hostnameOf(url);
  if (host) return SOCIAL_HOST.test(host);
  return /(?:x\.com|twitter\.com|t\.co)/i.test(url);
}

export function isLikelyDirectoryUrl(url: string): boolean {
  return DIRECTORY_HOST_PATH.test(hostnamePath(url));
}

function trimTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?)\]}>]+$/g, "");
}

/** Extract http(s) URLs from untrusted post text (size-bounded). */
export function extractHttpUrlsFromText(text?: string): string[] {
  if (!text) return [];
  const clipped = text.slice(0, 8_000);
  const matches = clipped.match(URL_IN_TEXT) ?? [];
  return uniqueUrls(matches.map(trimTrailingPunctuation));
}

/**
 * Candidate outbound URLs for an X lead (never the post URL alone).
 * Sources: metadata.officialUrl, links[], URLs in text.
 */
export function collectXOutboundUrls(lead: RawLead): string[] {
  const metaOfficial =
    typeof lead.metadata?.officialUrl === "string" ? lead.metadata.officialUrl : undefined;
  const combined = uniqueUrls([
    ...(metaOfficial && !isXSocialUrl(metaOfficial) ? [metaOfficial] : []),
    ...(lead.links ?? []),
    ...extractHttpUrlsFromText(lead.text),
  ]);
  return combined.filter((url) => !isXSocialUrl(url));
}

/**
 * Higher score = better official/apply enrichment target.
 * Directory listings score low but remain selectable so classify can reject them.
 */
export function scoreOfficialCandidateUrl(url: string): number {
  let score = 1;
  const host = hostnameOf(url) ?? "";
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();

  if (isLikelyDirectoryUrl(url)) score -= 8;
  if (PREFERRED_HOST.test(host)) score += 6;
  if (EDU_HOST.test(host)) score += 5;
  if (APPLY_PATH.test(path) || APPLY_PATH.test(url)) score += 4;
  if (EVENT_PATH.test(path) || EVENT_PATH.test(url)) score += 3;
  if (/\b(hack|devpost|mlh|luma|event)\b/i.test(host.replace(/\./g, " "))) score += 2;
  return score;
}

/**
 * Pick the best non-social official/apply URL for an X lead.
 * Returns undefined when the post has no usable outbound link.
 */
export function pickBestOfficialUrlForXLead(lead: RawLead): string | undefined {
  const candidates = collectXOutboundUrls(lead);
  if (candidates.length === 0) return undefined;

  const ranked = [...candidates].sort(
    (a, b) => scoreOfficialCandidateUrl(b) - scoreOfficialCandidateUrl(a),
  );
  const best = ranked[0];
  return best ? normalizeUrl(best) ?? best : undefined;
}

/** Resolve social/post URL for an X lead (never invent). */
export function resolveXSocialUrl(lead: RawLead): string | undefined {
  const fromMeta =
    typeof lead.metadata?.socialUrl === "string" ? lead.metadata.socialUrl : undefined;
  if (fromMeta && isXSocialUrl(fromMeta)) return normalizeUrl(fromMeta) ?? fromMeta;
  if (lead.url && isXSocialUrl(lead.url)) return normalizeUrl(lead.url) ?? lead.url;
  const fromLinks = (lead.links ?? []).find((link) => isXSocialUrl(link));
  return fromLinks ? normalizeUrl(fromLinks) ?? fromLinks : undefined;
}

export type SoftSearchOfficialOptions = {
  searchProvider?: SearchProvider | null;
  timeoutMs?: number;
  maxResults?: number;
};

/**
 * Optional assist for linkless X posts: web search when a provider is available.
 * Never throws — returns undefined on missing config, empty results, or errors.
 */
export async function softSearchOfficialUrlForXLead(
  lead: RawLead,
  options: SoftSearchOfficialOptions = {},
): Promise<string | undefined> {
  if (pickBestOfficialUrlForXLead(lead)) return undefined;

  const provider = options.searchProvider;
  if (!provider) return undefined;

  const nameHint = (lead.title ?? lead.text ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!nameHint) return undefined;

  try {
    const results = await provider.search({
      query: `${nameHint} hackathon apply official`,
      maxResults: options.maxResults ?? 5,
      timeoutMs: options.timeoutMs ?? 8_000,
    });

    for (const result of results) {
      const url = normalizeUrl(result.url);
      if (!url || isXSocialUrl(url)) continue;
      if (isLikelyDirectoryUrl(url)) continue;
      if (scoreOfficialCandidateUrl(url) >= 3) return url;
    }
  } catch {
    // Soft assist must never crash the run.
  }

  return undefined;
}
