import * as cheerio from "cheerio";
import type { RawLead } from "@/core/discovery/types";
import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";
import { fetchHtml } from "@/lib/http/fetchHtml";
import { normalizeUrl, normalizeUrlForDedupe, slugify, uniqueUrls } from "@/lib/http/url";

const HACKLIST_URL = "https://hacklist-omega.vercel.app/";

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
    );

    const applyUrl =
      article
        .find('a[href]')
        .filter((_i, node) => decodeHtml($(node).text()).toLowerCase() === "apply")
        .map((_i, node) => normalizeUrl($(node).attr("href") ?? "", HACKLIST_URL))
        .get()
        .find(Boolean) ?? links[0];

    const prizeBlock = article
      .find("p")
      .filter((_i, node) => decodeHtml($(node).text()).toLowerCase() === "prize pool")
      .first()
      .parent()
      .find("p")
      .eq(1)
      .text();

    const deadlineText = tagTexts.find((tag) =>
      /days left|closing soon|ending today/i.test(tag),
    );

    cards.push({
      title,
      organizer,
      description,
      url: links[0],
      applyUrl,
      links,
      mode: parseModeFromTags(tagTexts),
      themes: parseThemesFromTags(tagTexts),
      prize: decodeHtml(prizeBlock) || ariaParts.prize,
      deadlineText,
      statusTag: tagTexts.find((tag) => /closing|ending/i.test(tag)),
    });
  });

  const leads: RawLead[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    const dedupeKey = card.url
      ? normalizeUrlForDedupe(card.url)
      : slugify(card.title);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const allLinks = uniqueUrls(
      [card.url, card.applyUrl, ...card.links].filter(Boolean) as string[],
      HACKLIST_URL,
    );

    leads.push({
      id: `hacklist-${slugify(card.title)}`,
      source: "hacklist",
      title: card.title,
      url: card.url ?? HACKLIST_URL,
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
        officialUrl: card.url,
        applyUrl: card.applyUrl,
        location: card.mode === "online" ? "Online" : undefined,
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
      result.leads = parseHacklistHtml(html, input.maxResults);

      if (result.leads.length === 0) {
        result.warnings.push(
          "HackList returned no cards from static HTML; page may be client-rendered.",
        );
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : "HackList fetch failed");
    }

    result.durationMs = Date.now() - startedAt;
    return result;
  },
};
