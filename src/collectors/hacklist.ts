import * as cheerio from "cheerio";
import type { RawLead } from "@/core/discovery/types";
import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";
import { fetchHtml, FetchHtmlError } from "@/lib/http/fetchHtml";
import { normalizeUrl, normalizeUrlForDedupe, slugify, uniqueUrls } from "@/lib/http/url";

/**
 * HackList public directory (SSR cards). Each article card is an individual
 * hackathon row with an external Apply URL — not a substitute for generic web search.
 */
const HACKLIST_URL = "https://hacklist-omega.vercel.app/";
const HACKLIST_HOST = "hacklist-omega.vercel.app";

export type HacklistFailureHint =
  | "network"
  | "anti_bot"
  | "rate_limit"
  | "selector_parser_failure"
  | "zero_matching_results"
  | "no_current_events";

type ParsedHacklistCard = {
  title: string;
  organizer?: string;
  description?: string;
  url?: string;
  applyUrl?: string;
  links: string[];
  mode?: string;
  themes: string[];
  prize?: string;
  deadlineText?: string;
  statusTag?: string;
};

function decodeHtml(value: string): string {
  return value
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseModeFromTags(tags: string[]): string | undefined {
  const lower = tags.map((tag) => tag.toLowerCase());
  if (lower.includes("online") && (lower.includes("in-person") || lower.includes("both"))) {
    return "hybrid";
  }
  if (lower.includes("both")) return "hybrid";
  if (lower.includes("online")) return "online";
  if (lower.includes("in-person")) return "in-person";
  return undefined;
}

function parseThemesFromTags(tags: string[]): string[] {
  const themes = new Set<string>();
  for (const tag of tags) {
    const normalized = tag.trim();
    if (/^(ai|web3)$/i.test(normalized)) {
      themes.add(normalized.toUpperCase() === "AI" ? "AI" : "web3");
    }
  }
  return [...themes];
}

function parseAriaLabel(ariaLabel: string): { title?: string; prize?: string } {
  const match = ariaLabel.match(/^(.+?),\s*(.+?)\.\s*(?:Spotlight\.\s*)?View details\.$/i);
  if (!match) {
    return { title: ariaLabel.split(",")[0]?.trim() };
  }
  return { title: match[1]?.trim(), prize: match[2]?.trim() };
}

function isHacklistDirectoryUrl(url: string | undefined): boolean {
  if (!url) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === HACKLIST_HOST ||
      (host.endsWith(".vercel.app") && host.includes("hacklist"))
    );
  } catch {
    return true;
  }
}

function extractPrize(article: ReturnType<cheerio.CheerioAPI>, $: cheerio.CheerioAPI): string | undefined {
  const prizeLabel = article
    .find("p, span, div")
    .filter((_i, node) => decodeHtml($(node).text()).toLowerCase() === "prize pool")
    .first();

  if (prizeLabel.length) {
    const parent = prizeLabel.parent();
    const siblingText = parent
      .children()
      .map((_i, node) => decodeHtml($(node).text()))
      .get()
      .find((text) => text && text.toLowerCase() !== "prize pool" && /\$|₹|€|£|\d/.test(text));
    if (siblingText) return siblingText;

    const nearby = parent
      .find("span, p")
      .map((_i, node) => decodeHtml($(node).text()))
      .get()
      .find((text) => text && text.toLowerCase() !== "prize pool" && /\$|₹|€|£|\d/.test(text));
    if (nearby) return nearby;
  }

  return undefined;
}

/**
 * Classify empty/failed HackList outcomes for diagnostics (message-compatible
 * with src/lib/sources/classify.ts).
 */
export function describeHacklistFailure(
  hint: HacklistFailureHint,
  detail?: string,
): string {
  switch (hint) {
    case "network":
      return `HackList network failure${detail ? `: ${detail}` : ""}`;
    case "anti_bot":
      return `HackList blocked or anti-bot response${detail ? `: ${detail}` : ""}`;
    case "rate_limit":
      return `HackList rate limit${detail ? `: ${detail}` : ""}`;
    case "selector_parser_failure":
      return `HackList selector/parser failure: UI may have changed${detail ? ` (${detail})` : ""}`;
    case "no_current_events":
      return "HackList returned no current/upcoming event cards.";
    case "zero_matching_results":
      return "HackList returned no matching hackathon cards.";
  }
}

export function countHacklistCards(html: string): number {
  const $ = cheerio.load(html);
  return $("article[aria-label]").length;
}

export function parseHacklistHtml(html: string, maxResults: number): RawLead[] {
  const $ = cheerio.load(html);
  const cards: ParsedHacklistCard[] = [];

  $("article[aria-label]").each((_index, element) => {
    const article = $(element);
    const ariaLabel = article.attr("aria-label") ?? "";
    const ariaParts = parseAriaLabel(ariaLabel);

    const title =
      decodeHtml(article.find("h3").first().text()) ||
      ariaParts.title ||
      "";
    if (!title) return;

    const organizer = decodeHtml(article.find("p.truncate").first().text()) || undefined;
    const description =
      decodeHtml(
        article
          .find("p")
          .filter((_i, node) => {
            const style = $(node).attr("style") ?? "";
            return style.includes("-webkit-line-clamp:2") || style.includes("line-clamp:2");
          })
          .first()
          .text(),
      ) || undefined;

    const tagTexts = article
      .find("span")
      .map((_i, node) => decodeHtml($(node).text()))
      .get()
      .filter(Boolean);

    const links = uniqueUrls(
      article
        .find("a[href]")
        .map((_i, node) => $(node).attr("href") ?? "")
        .get(),
      HACKLIST_URL,
    ).filter((link) => !isHacklistDirectoryUrl(link));

    const applyUrl =
      article
        .find("a[href]")
        .filter((_i, node) => decodeHtml($(node).text()).toLowerCase() === "apply")
        .map((_i, node) => normalizeUrl($(node).attr("href") ?? "", HACKLIST_URL))
        .get()
        .find((href) => href && !isHacklistDirectoryUrl(href)) ?? links[0];

    // Require an external event/apply URL so we do not emit the directory itself.
    if (!applyUrl && links.length === 0) return;

    const deadlineText =
      tagTexts.find((tag) => /days left|closing soon|ending today/i.test(tag)) ||
      article
        .find("span")
        .filter((_i, node) => /days left|closing soon|ending today/i.test(decodeHtml($(node).text())))
        .first()
        .text()
        .trim() ||
      undefined;

    const statusTag =
      tagTexts.find((tag) => /closing|ending|days left/i.test(tag)) ||
      article
        .find("span")
        .filter((_i, node) => {
          const text = decodeHtml($(node).text());
          return /closing soon|ending today/i.test(text);
        })
        .first()
        .text()
        .trim() ||
      undefined;

    cards.push({
      title,
      organizer,
      description,
      url: applyUrl ?? links[0],
      applyUrl,
      links,
      mode: parseModeFromTags(tagTexts),
      themes: parseThemesFromTags(tagTexts),
      prize: extractPrize(article, $) || ariaParts.prize,
      deadlineText,
      statusTag,
    });
  });

  const leads: RawLead[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    const officialUrl = card.url ?? card.applyUrl;
    if (!officialUrl || isHacklistDirectoryUrl(officialUrl)) continue;

    const dedupeKey = normalizeUrlForDedupe(officialUrl);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const allLinks = uniqueUrls(
      [card.url, card.applyUrl, ...card.links].filter(Boolean) as string[],
      HACKLIST_URL,
    ).filter((link) => !isHacklistDirectoryUrl(link));

    leads.push({
      id: `hacklist-${slugify(card.title)}`,
      source: "hacklist",
      title: card.title,
      url: officialUrl,
      text: [card.organizer, card.description, card.prize, card.deadlineText]
        .filter(Boolean)
        .join(" — "),
      links: allLinks,
      postedAt: new Date().toISOString(),
      metadata: {
        organizer: card.organizer,
        mode: card.mode,
        themes: card.themes,
        prize: card.prize,
        deadlineText: card.deadlineText,
        statusTag: card.statusTag,
        officialUrl,
        applyUrl: card.applyUrl ?? officialUrl,
        location: card.mode === "online" ? "Online" : undefined,
        attribution: "hacklist",
        provenance: "hacklist_card",
        sourceIds: { hacklist: slugify(card.title) },
      },
    });

    if (leads.length >= maxResults) break;
  }

  return leads;
}

export const hacklistCollector: Collector = {
  source: "hacklist",

  async collect(input: CollectorInput): Promise<CollectorResult> {
    const startedAt = Date.now();
    const result = emptyCollectorResult("hacklist", startedAt);

    try {
      const html = await fetchHtml(HACKLIST_URL, { timeoutMs: input.timeoutMs });
      const cardCount = countHacklistCards(html);
      result.leads = parseHacklistHtml(html, input.maxResults);
      result.metrics = {
        cardsParsed: cardCount,
        leadsEmitted: result.leads.length,
        pagesFetched: 1,
      };

      if (result.leads.length === 0) {
        if (cardCount === 0) {
          const looksLikeApp =
            /hacklist|All Hackathons|hacklist-logo/i.test(html) || html.includes("self.__next_f");
          if (looksLikeApp) {
            result.warnings.push(
              describeHacklistFailure(
                "selector_parser_failure",
                "page loaded but no article[aria-label] cards found",
              ),
            );
          } else {
            result.warnings.push(describeHacklistFailure("zero_matching_results"));
          }
        } else {
          result.warnings.push(
            describeHacklistFailure(
              "zero_matching_results",
              `${cardCount} cards found but none had external apply/official URLs`,
            ),
          );
        }
      }
    } catch (error) {
      if (error instanceof FetchHtmlError) {
        if (error.status === 429) {
          result.errors.push(describeHacklistFailure("rate_limit", error.message));
        } else if (error.status === 403 || error.status === 503) {
          result.errors.push(describeHacklistFailure("anti_bot", error.message));
        } else {
          result.errors.push(describeHacklistFailure("network", error.message));
        }
      } else {
        const message = error instanceof Error ? error.message : "HackList fetch failed";
        result.errors.push(describeHacklistFailure("network", message));
      }
    }

    result.durationMs = Date.now() - startedAt;
    return result;
  },
};
