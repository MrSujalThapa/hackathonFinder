import * as cheerio from "cheerio";
import type { RawLead } from "@/core/discovery/types";
import type { DiscoveryPreferences } from "@/core/discovery/types";
import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";
import { fetchHtml } from "@/lib/http/fetchHtml";
import {
  formatPlaywrightInstallHint,
  isPlaywrightBrowserMissingError,
  withPlaywright,
} from "@/lib/browser/playwright";
import { normalizeUrl, normalizeUrlForDedupe, slugify, uniqueUrls } from "@/lib/http/url";

const DEVPOST_BASE = "https://devpost.com";

type ParsedDevpostCard = {
  title: string;
  url: string;
  description?: string;
  prize?: string;
  dateText?: string;
  location?: string;
  links: string[];
};

function buildDevpostSearchUrl(preferences: DiscoveryPreferences): string {
  const params = new URLSearchParams();
  params.append("status[]", "upcoming");
  params.append("challenge_type[]", "online");
  params.append("challenge_type[]", "in-person");

  if (preferences.includeRemote) {
    params.append("challenge_type[]", "online");
  }

  const searchTerms = [...preferences.themes, ...preferences.locations]
    .filter((term) => !/^(canada|remote|online)$/i.test(term))
    .slice(0, 3);

  if (searchTerms.length > 0) {
    params.set("search", searchTerms.join(" "));
  }

  return `${DEVPOST_BASE}/hackathons?${params.toString()}`;
}

function isDevpostHackathonUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith("devpost.com")) return false;

    const blockedHosts = new Set([
      "info.devpost.com",
      "help.devpost.com",
      "secure.devpost.com",
      "support.devpost.com",
      "api.devpost.com",
    ]);
    if (blockedHosts.has(host)) return false;

    if (host === "devpost.com" || host === "www.devpost.com") {
      return (
        /^\/[^/]+\/?$/.test(parsed.pathname) &&
        !["/hackathons", "/software", "/settings", "/follows", "/notifications"].includes(
          parsed.pathname.replace(/\/$/, "") || "/",
        )
      );
    }

    // Challenge subdomain pages like ai-agent-summit.devpost.com
    return true;
  } catch {
    return false;
  }
}

export function parseDevpostHtml(html: string, maxResults: number): RawLead[] {
  const $ = cheerio.load(html);
  const cards: ParsedDevpostCard[] = [];

  const selectors = [
    "a.block-wrapper-link",
    "a.challenge-listing",
    "a.link-to-software",
    "a[href*='.devpost.com/']",
  ];

  for (const selector of selectors) {
    $(selector).each((_index, element) => {
      const anchor = $(element);
      const href = normalizeUrl(anchor.attr("href") ?? "", DEVPOST_BASE);
      if (!href || !isDevpostHackathonUrl(href)) return;

      const title =
        anchor.find("h2, h3, .title, .challenge-title").first().text().trim() ||
        anchor.attr("title")?.trim() ||
        "";
      if (!title || title.length < 4) return;
      if (/^(log in|sign up|help desk|settings|about)$/i.test(title)) return;

      const meta = anchor.find(".challenge-list-meta, .meta, .challenge-list-meta-challenge").text();
      const prize =
        anchor.find(".prize, .prizes").first().text().trim() ||
        meta.match(/\$[\d,]+[^|\n]*/)?.[0]?.trim();
      const dateText =
        anchor.find(".submission-period, .date-range, time").first().text().trim() ||
        meta.match(/[A-Z][a-z]{2}\s+\d{1,2}[^|\n]*/)?.[0]?.trim();
      const location =
        anchor.find(".location, .challenge-location").first().text().trim() ||
        meta.match(/Online|Remote|Toronto|Canada|Worldwide/i)?.[0]?.trim();

      cards.push({
        title,
        url: href,
        description: anchor.find(".description, p").first().text().trim() || undefined,
        prize,
        dateText,
        location,
        links: uniqueUrls([href], DEVPOST_BASE),
      });
    });
  }

  const leads: RawLead[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    const key = normalizeUrlForDedupe(card.url);
    if (seen.has(key)) continue;
    seen.add(key);

    const mode = /online|remote|virtual|worldwide/i.test(card.location ?? card.description ?? "")
      ? "online"
      : undefined;

    leads.push({
      id: `devpost-${slugify(card.title)}`,
      source: "devpost",
      title: card.title,
      url: card.url,
      text: [card.description, card.prize, card.dateText, card.location]
        .filter(Boolean)
        .join(" — "),
      links: card.links,
      postedAt: new Date().toISOString(),
      metadata: {
        prize: card.prize,
        dateText: card.dateText,
        location: card.location,
        mode,
        officialUrl: card.url,
        sourceIds: { devpost: slugify(card.title) },
      },
    });

    if (leads.length >= maxResults) break;
  }

  return leads;
}

async function fetchDevpostWithPlaywright(
  url: string,
  timeoutMs: number,
): Promise<{ html: string; warnings: string[] }> {
  const warnings: string[] = [];

  const html = await withPlaywright(async ({ page }) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page
      .locator("a[href*='.devpost.com/'], .challenge-list, #results-and-filters")
      .first()
      .waitFor({ state: "attached", timeout: timeoutMs })
      .catch(() => {
        warnings.push("Devpost listing content did not fully render within timeout.");
      });
    return page.content();
  }, { timeoutMs });

  return { html, warnings };
}

export const devpostCollector: Collector = {
  source: "devpost",

  async collect(input: CollectorInput): Promise<CollectorResult> {
    const startedAt = Date.now();
    const result = emptyCollectorResult("devpost", startedAt);
    const searchUrl = buildDevpostSearchUrl(input.preferences);

    try {
      let html = await fetchHtml(searchUrl, { timeoutMs: input.timeoutMs });
      result.leads = parseDevpostHtml(html, input.maxResults);

      if (result.leads.length === 0) {
        try {
          const rendered = await fetchDevpostWithPlaywright(searchUrl, input.timeoutMs);
          html = rendered.html;
          result.warnings.push(...rendered.warnings);
          result.leads = parseDevpostHtml(html, input.maxResults);
        } catch (error) {
          if (isPlaywrightBrowserMissingError(error)) {
            result.warnings.push(formatPlaywrightInstallHint());
          } else {
            result.warnings.push(
              error instanceof Error ? error.message : "Devpost Playwright fallback failed",
            );
          }
        }
      }

      if (result.leads.length === 0) {
        result.warnings.push("Devpost returned no hackathon cards.");
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : "Devpost fetch failed");
    }

    result.durationMs = Date.now() - startedAt;
    return result;
  },
};
