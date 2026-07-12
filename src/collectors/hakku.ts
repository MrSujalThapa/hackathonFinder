import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright";
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
import { normalizeUrlForDedupe, slugify, uniqueUrls } from "@/lib/http/url";

export const HAKKU_SWIPE_URL = "https://tryhakku.vercel.app/swipe";
const HAKKU_ORIGIN = "https://tryhakku.vercel.app";

const MAX_SCROLL_ROUNDS = 4;
const CONTENT_SELECTOR =
  "main, [data-testid='swipe-card'], article, .card, h1, h2, h3, input[type='password'], form";

export type HakkuCard = {
  title: string;
  url?: string;
  text?: string;
  links: string[];
  tags: string[];
};

export type HakkuExtractResult = {
  cards: HakkuCard[];
  authStatus: HakkuAuthStatus;
  pagesInspected: number;
  mode: HakkuCollectMode;
  stopReason: HakkuStopReason;
};

export function parseHakkuCards(cards: HakkuCard[], maxResults: number): RawLead[] {
  const leads: RawLead[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    const key = card.url ? normalizeUrlForDedupe(card.url) : slugify(card.title);
    if (seen.has(key)) continue;
    seen.add(key);

    const links = uniqueUrls([card.url, ...card.links].filter(Boolean) as string[], HAKKU_SWIPE_URL);
    const mode = card.tags.some((tag) => /online|remote/i.test(tag))
      ? "online"
      : card.tags.some((tag) => /in[- ]?person|hybrid|both/i.test(tag))
        ? "in-person"
        : undefined;

    leads.push({
      id: `hakku-${slugify(card.title)}`,
      source: "hakku",
      title: card.title,
      url: card.url ?? HAKKU_SWIPE_URL,
      text: [card.text, ...card.tags].filter(Boolean).join(" — "),
      links: links.length > 0 ? links : [HAKKU_SWIPE_URL],
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
  const hasSwipeCards =
    (await page
      .locator("[data-testid='swipe-card'], article.card, .swipe-card, [class*='SwipeCard']")
      .count()
      .catch(() => 0)) > 0;

  return { url, title, bodyText, hasSwipeCards, hasPasswordField };
}

async function extractCardsFromPage(page: Page): Promise<HakkuCard[]> {
  return page.evaluate(() => {
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
      if (/welcome back|sign in|sign up|enter your credentials/i.test(title)) continue;
      seenTitles.add(title.toLowerCase());

      const links = Array.from(root.querySelectorAll("a[href]"))
        .map((anchor) => {
          const href = anchor.getAttribute("href") ?? "";
          try {
            return new URL(href, "https://tryhakku.vercel.app").toString();
          } catch {
            return "";
          }
        })
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
}

async function boundedScrollForMore(page: Page, timeoutMs: number): Promise<void> {
  const perRound = Math.min(2_500, Math.max(500, Math.floor(timeoutMs / MAX_SCROLL_ROUNDS)));
  for (let i = 0; i < MAX_SCROLL_ROUNDS; i += 1) {
    await page.mouse.wheel(0, 1400).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, Math.min(perRound, 400)));
  }
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
}): Promise<HakkuExtractResult> {
  const { profileDir, timeoutMs, headless } = options;

  return withPersistentPlaywright(
    profileDir,
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
          };
        }

        // Soft health: if we landed off-swipe, try once more on the swipe route.
        if (!signals.url.includes("/swipe")) {
          await page.goto(HAKKU_SWIPE_URL, {
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
            };
          }
        }

        await boundedScrollForMore(page, timeoutMs);
        const rawCards = await extractCardsFromPage(page);
        const cards = filterUpcomingHakkuCards(rawCards);

        const mode: HakkuCollectMode =
          authStatus === "authenticated" ? "authenticated" : "public";

        return {
          cards,
          authStatus,
          pagesInspected,
          mode,
          stopReason: cards.length === 0 ? "no_cards" : "completed",
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
  };

  result.warnings.push(`mode=${extract.mode}`);
  result.warnings.push(`auth_status=${extract.authStatus}`);
  result.warnings.push(`stop_reason=${extract.stopReason}`);
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
        writeHakkuSessionMeta("profile_missing");
        result.durationMs = Date.now() - startedAt;
        return result;
      }

      const extract = await extractVisibleHakkuCards({
        profileDir,
        timeoutMs: input.timeoutMs,
        headless,
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

      if (extract.authStatus === "authenticated") {
        writeHakkuSessionMeta("connected");
      } else if (extract.authStatus === "unknown") {
        writeHakkuSessionMeta("unknown");
      }

      if (result.leads.length === 0 && extract.stopReason === "no_cards") {
        result.warnings.push(
          "Hakku returned no upcoming event cards; UI may have changed or the feed is empty.",
        );
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
    }

    result.durationMs = Date.now() - startedAt;
    return result;
  },
};

// Keep origin constant available for tests without exporting secrets/paths.
export const HAKKU_PUBLIC_ORIGIN = HAKKU_ORIGIN;
