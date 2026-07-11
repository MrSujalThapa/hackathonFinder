import type { RawLead } from "@/core/discovery/types";
import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";
import {
  formatPlaywrightInstallHint,
  isPlaywrightBrowserMissingError,
  withPlaywright,
} from "@/lib/browser/playwright";
import { normalizeUrlForDedupe, slugify, uniqueUrls } from "@/lib/http/url";

const HAKKU_URL = "https://tryhakku.vercel.app/swipe";

export type HakkuCard = {
  title: string;
  url?: string;
  text?: string;
  links: string[];
  tags: string[];
};

export function parseHakkuCards(cards: HakkuCard[], maxResults: number): RawLead[] {
  const leads: RawLead[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    const key = card.url ? normalizeUrlForDedupe(card.url) : slugify(card.title);
    if (seen.has(key)) continue;
    seen.add(key);

    const links = uniqueUrls([card.url, ...card.links].filter(Boolean) as string[], HAKKU_URL);
    const mode = card.tags.some((tag) => /online|remote/i.test(tag))
      ? "online"
      : card.tags.some((tag) => /in[- ]?person|hybrid|both/i.test(tag))
        ? "in-person"
        : undefined;

    leads.push({
      id: `hakku-${slugify(card.title)}`,
      source: "hakku",
      title: card.title,
      url: card.url ?? HAKKU_URL,
      text: [card.text, ...card.tags].filter(Boolean).join(" — "),
      links: links.length > 0 ? links : [HAKKU_URL],
      postedAt: new Date().toISOString(),
      metadata: {
        themes: card.tags.filter((tag) => /ai|web3|cloud|agent/i.test(tag)),
        mode,
        officialUrl: card.url,
        sourceIds: { hakku: slugify(card.title) },
      },
    });

    if (leads.length >= maxResults) break;
  }

  return leads;
}

async function extractVisibleHakkuCards(
  timeoutMs: number,
): Promise<{ cards: HakkuCard[]; loginRequired: boolean }> {
  return withPlaywright(async ({ page }) => {
    await page.goto(HAKKU_URL, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    await page
      .locator("main, [data-testid='swipe-card'], article, .card, h1, h2, h3")
      .first()
      .waitFor({ state: "visible", timeout: Math.min(timeoutMs, 8_000) })
      .catch(() => undefined);

    const bodyText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
    const loginRequired =
      /welcome back|sign in|enter your credentials|continue with|forgot\?/.test(bodyText) &&
      !/swipe|hackathon|apply|prize/.test(bodyText);

    if (loginRequired) {
      return { cards: [], loginRequired: true };
    }

    const cards = await page.evaluate(() => {
      const cards: HakkuCard[] = [];
      const seenTitles = new Set<string>();

      const cardRoots = Array.from(
        document.querySelectorAll(
          "[data-testid='swipe-card'], article, .card, [class*='card'], main section",
        ),
      );

      const roots = cardRoots.length > 0 ? cardRoots : [document.body];

      for (const root of roots) {
        const titleNode =
          root.querySelector("h1, h2, h3, [data-testid='title'], .title") ??
          root.querySelector("strong");
        const title = titleNode?.textContent?.trim() ?? "";
        if (!title || title.length < 3 || seenTitles.has(title.toLowerCase())) continue;
        if (/welcome back|sign in|sign up/i.test(title)) continue;
        seenTitles.add(title.toLowerCase());

        const links = Array.from(root.querySelectorAll("a[href]"))
          .map((anchor) => anchor.getAttribute("href") ?? "")
          .filter((href) => /^https?:\/\//.test(href));

        const tagTexts = Array.from(root.querySelectorAll("span, .tag, .badge"))
          .map((node) => node.textContent?.trim() ?? "")
          .filter((text) => text.length > 0 && text.length < 40);

        const paragraphs = Array.from(root.querySelectorAll("p"))
          .map((node) => node.textContent?.trim() ?? "")
          .filter(Boolean);

        cards.push({
          title,
          url: links[0],
          text: paragraphs.join(" "),
          links,
          tags: tagTexts,
        });
      }

      return cards;
    });

    return { cards, loginRequired: false };
  }, { timeoutMs });
}

export const hakkuCollector: Collector = {
  source: "hakku",

  async collect(input: CollectorInput): Promise<CollectorResult> {
    const startedAt = Date.now();
    const result = emptyCollectorResult("hakku", startedAt);

    try {
      const { cards, loginRequired } = await extractVisibleHakkuCards(input.timeoutMs);
      result.leads = parseHakkuCards(cards, input.maxResults);

      if (loginRequired) {
        result.warnings.push(
          "Hakku requires login; public swipe cards are not available without authentication.",
        );
      } else if (result.leads.length === 0) {
        result.warnings.push(
          "Hakku returned no visible cards; UI may have changed or requires interaction.",
        );
      }
    } catch (error) {
      if (isPlaywrightBrowserMissingError(error)) {
        result.errors.push(formatPlaywrightInstallHint());
      } else {
        result.errors.push(error instanceof Error ? error.message : "Hakku collection failed");
      }
    }

    result.durationMs = Date.now() - startedAt;
    return result;
  },
};
