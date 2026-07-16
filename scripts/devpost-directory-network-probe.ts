/**
 * Live Devpost directory growth discovery.
 * Opens https://devpost.com/hackathons (unfiltered), scrolls, captures network.
 *
 * Usage: npx tsx scripts/devpost-directory-network-probe.ts
 * Output: .local-audits/traces/full-directory-recall/devpost-network-*.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnv } from "@/cli/loadEnv";
import {
  formatPlaywrightInstallHint,
  isPlaywrightBrowserMissingError,
  withPlaywright,
} from "@/lib/browser/playwright";
import { normalizeUrlForDedupe } from "@/lib/http/url";

loadLocalEnv();

const OUT_DIR = resolve(process.cwd(), ".local-audits/traces/full-directory-recall");
const MAX_SCROLLS = 120;
const NO_GROWTH_LIMIT = 5;
const WAIT_MS = 1_200;
const TIMEOUT_MS = 10 * 60_000;

type CapturedRequest = {
  atMs: number;
  scrollIndex: number;
  method: string;
  url: string;
  resourceType: string;
  status?: number;
  postData?: string;
  responsePreview?: string;
  responseJsonMeta?: Record<string, unknown>;
};

type GrowthStep = {
  scrollIndex: number;
  uniqueBefore: number;
  uniqueAfter: number;
  added: number;
  sampleNewUrls: string[];
  requestsSinceLast: CapturedRequest[];
};

function isInterestingUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (!/devpost\.com/i.test(lower)) return false;
  if (/\.(png|jpg|jpeg|gif|svg|webp|css|woff2?|ttf|ico)(\?|$)/i.test(lower)) return false;
  return (
    /\/api\//i.test(lower) ||
    /graphql/i.test(lower) ||
    /hackathon/i.test(lower) ||
    /challenge/i.test(lower) ||
    /search/i.test(lower) ||
    /page=/i.test(lower) ||
    /cursor=/i.test(lower) ||
    /offset=/i.test(lower)
  );
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const startedAt = Date.now();
  const stamp = startedAt;

  try {
    const report = await withPlaywright(
      async ({ page }) => {
        const captured: CapturedRequest[] = [];
        const growth: GrowthStep[] = [];
        let scrollIndex = 0;
        let pending: CapturedRequest[] = [];

        page.on("request", (request) => {
          const url = request.url();
          if (!isInterestingUrl(url)) return;
          pending.push({
            atMs: Date.now() - startedAt,
            scrollIndex,
            method: request.method(),
            url,
            resourceType: request.resourceType(),
            postData: request.postData()?.slice(0, 2_000),
          });
        });

        page.on("response", async (response) => {
          const url = response.url();
          if (!isInterestingUrl(url)) return;
          const match =
            pending.find((item) => item.url === url && item.status == null) ??
            captured.find((item) => item.url === url && item.status == null);
          const target = match ?? {
            atMs: Date.now() - startedAt,
            scrollIndex,
            method: "GET",
            url,
            resourceType: "xhr",
          };
          target.status = response.status();
          try {
            const ct = response.headers()["content-type"] ?? "";
            if (/json/i.test(ct)) {
              const json = (await response.json().catch(() => null)) as Record<
                string,
                unknown
              > | null;
              if (json && typeof json === "object") {
                const hackathons = Array.isArray(json.hackathons)
                  ? json.hackathons
                  : Array.isArray((json as { data?: { hackathons?: unknown } }).data?.hackathons)
                    ? (json as { data: { hackathons: unknown[] } }).data.hackathons
                    : undefined;
                const meta =
                  json.meta && typeof json.meta === "object"
                    ? (json.meta as Record<string, unknown>)
                    : undefined;
                target.responseJsonMeta = {
                  keys: Object.keys(json).slice(0, 24),
                  hackathonCount: Array.isArray(hackathons) ? hackathons.length : null,
                  meta,
                  sampleOpenState:
                    Array.isArray(hackathons) && hackathons[0] && typeof hackathons[0] === "object"
                      ? (hackathons[0] as { open_state?: string }).open_state
                      : undefined,
                  sampleUrl:
                    Array.isArray(hackathons) && hackathons[0] && typeof hackathons[0] === "object"
                      ? (hackathons[0] as { url?: string }).url
                      : undefined,
                };
                target.responsePreview = JSON.stringify({
                  meta,
                  count: Array.isArray(hackathons) ? hackathons.length : null,
                  first: Array.isArray(hackathons)
                    ? hackathons.slice(0, 2).map((item) =>
                        item && typeof item === "object"
                          ? {
                              title: (item as { title?: string }).title,
                              url: (item as { url?: string }).url,
                              open_state: (item as { open_state?: string }).open_state,
                            }
                          : null,
                      )
                    : null,
                }).slice(0, 2_500);
              }
            } else {
              const text = await response.text().catch(() => "");
              target.responsePreview = text.slice(0, 400);
            }
          } catch {
            /* ignore body parse */
          }
          if (!captured.includes(target) && !pending.includes(target)) captured.push(target);
          for (const item of pending) {
            if (item.url === url && item.status == null) {
              item.status = target.status;
              item.responseJsonMeta = target.responseJsonMeta;
              item.responsePreview = target.responsePreview;
            }
          }
        });

        const directoryUrl = "https://devpost.com/hackathons";
        console.log(`Navigating ${directoryUrl}`);
        await page.goto(directoryUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page
          .locator("a.tile-anchor")
          .first()
          .waitFor({ state: "attached", timeout: 20_000 })
          .catch(() => undefined);
        await page.waitForTimeout(1_500);

        const initialState = await page.evaluate(() => {
          const scripts = Array.from(document.querySelectorAll("script")).map((el) =>
            (el.textContent ?? "").slice(0, 200),
          );
          const nextData = document.querySelector("#__NEXT_DATA__")?.textContent?.slice(0, 500);
          const gon = (window as unknown as { gon?: unknown }).gon;
          return {
            finalUrl: location.href,
            title: document.title,
            nextDataPresent: Boolean(nextData),
            nextDataPreview: nextData ?? null,
            gonKeys: gon && typeof gon === "object" ? Object.keys(gon as object).slice(0, 40) : [],
            scriptHints: scripts.filter((s) => /hackathon|api|graphql|page/i.test(s)).slice(0, 10),
          };
        });

        const seen = new Set<string>();
        const collectUrls = async (): Promise<string[]> =>
          page.locator("a.tile-anchor").evaluateAll((anchors) =>
            anchors.map((a) => (a as HTMLAnchorElement).href).filter(Boolean),
          );

        const merge = async (): Promise<{ unique: number; added: string[] }> => {
          const urls = await collectUrls();
          const added: string[] = [];
          for (const url of urls) {
            const key = normalizeUrlForDedupe(url);
            if (seen.has(key)) continue;
            seen.add(key);
            added.push(url);
          }
          return { unique: seen.size, added };
        };

        const { unique, added } = await merge();
        console.log(`Initial unique tiles: ${unique}`);
        growth.push({
          scrollIndex: 0,
          uniqueBefore: 0,
          uniqueAfter: unique,
          added: added.length,
          sampleNewUrls: added.slice(0, 5),
          requestsSinceLast: [...pending],
        });
        captured.push(...pending);
        pending = [];

        let noGrowth = 0;
        let stopReason = "max_scrolls";

        while (scrollIndex < MAX_SCROLLS && Date.now() - startedAt < TIMEOUT_MS) {
          const before = seen.size;
          scrollIndex += 1;
          console.log(`Scroll ${scrollIndex} (unique=${before})…`);
          await page.mouse.wheel(0, 3_200);
          await page.evaluate(() => window.scrollBy(0, 3_200)).catch(() => undefined);
          // Click common load-more patterns if present.
          const loadMore = page.locator(
            "button:has-text('Load more'), a:has-text('Load more'), button:has-text('Show more'), [data-testid*='load']",
          );
          if ((await loadMore.count().catch(() => 0)) > 0) {
            await loadMore.first().click({ timeout: 1_500 }).catch(() => undefined);
          }
          await page.waitForTimeout(WAIT_MS);
          await page.waitForLoadState("networkidle", { timeout: 2_500 }).catch(() => undefined);

          const step = await merge();
          const stepRequests = [...pending];
          captured.push(...pending);
          pending = [];
          growth.push({
            scrollIndex,
            uniqueBefore: before,
            uniqueAfter: step.unique,
            added: step.added.length,
            sampleNewUrls: step.added.slice(0, 5),
            requestsSinceLast: stepRequests,
          });
          console.log(
            `  → unique=${step.unique} (+${step.added.length}) requests=${stepRequests.length}`,
          );
          for (const req of stepRequests.slice(0, 8)) {
            console.log(
              `     ${req.method} ${req.status ?? "?"} ${req.url.slice(0, 160)} meta=${JSON.stringify(req.responseJsonMeta ?? null).slice(0, 120)}`,
            );
          }

          if (step.added.length === 0) {
            noGrowth += 1;
            if (noGrowth >= NO_GROWTH_LIMIT) {
              stopReason = "no_growth";
              break;
            }
          } else {
            noGrowth = 0;
          }
        }

        if (Date.now() - startedAt >= TIMEOUT_MS) stopReason = "timeout";

        // Status labels from visible tiles
        const statusSample = await page.locator("a.tile-anchor").evaluateAll((anchors) => {
          const counts: Record<string, number> = {};
          for (const anchor of anchors.slice(0, 80)) {
            const el = anchor as HTMLElement;
            const label =
              el.querySelector(".status-label, .hackathon-status, .label")?.textContent?.trim() ||
              "unknown";
            counts[label] = (counts[label] ?? 0) + 1;
          }
          return counts;
        });

        // Prefer accumulating identities from API JSON responses (DOM virtualizes).
        const apiUnique = new Set<string>();
        const apiStatuses: Record<string, number> = {};
        for (const req of captured) {
          if (!/\/api\/hackathons/i.test(req.url) || !req.responsePreview) continue;
          try {
            const parsed = JSON.parse(req.responsePreview) as {
              first?: Array<{ url?: string; open_state?: string } | null>;
            };
            for (const item of parsed.first ?? []) {
              if (!item?.url) continue;
              apiUnique.add(normalizeUrlForDedupe(item.url));
              const status = item.open_state ?? "unknown";
              apiStatuses[status] = (apiStatuses[status] ?? 0) + 1;
            }
          } catch {
            /* ignore */
          }
        }

        const cookies = await page.context().cookies("https://devpost.com").catch(() => []);

        return {
          measuredAt: new Date().toISOString(),
          directoryUrl,
          finalUrl: page.url(),
          initialState,
          stopReason,
          scrollIterations: scrollIndex,
          uniqueCardsDom: seen.size,
          uniqueCardsFromCapturedApiSamples: apiUnique.size,
          durationMs: Date.now() - startedAt,
          statusSample,
          apiStatusesFromSamples: apiStatuses,
          growth,
          capturedRequests: captured,
          cookieNames: cookies.map((c) => c.name),
          sampleUrls: [...seen].slice(0, 40),
          discoveryNote:
            "Browser directory uses GET /api/hackathons?page=N without status filters; meta.total_count is far larger than open+upcoming subset.",
        };
      },
      { timeoutMs: TIMEOUT_MS + 60_000, headless: true },
    );

    const outPath = resolve(OUT_DIR, `devpost-network-${stamp}.json`);
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
    console.log(`\nWrote ${outPath}`);
    console.log(
      `uniqueDom=${report.uniqueCardsDom} scrolls=${report.scrollIterations} stop=${report.stopReason} durationMs=${report.durationMs}`,
    );

    const apiUrls = [
      ...new Set(
        report.capturedRequests
          .map((r) => r.url)
          .filter((url) => /\/api\/|graphql/i.test(url)),
      ),
    ];
    console.log(`Distinct API/GraphQL URLs (${apiUrls.length}):`);
    for (const url of apiUrls.slice(0, 40)) console.log(`  ${url}`);
  } catch (error) {
    if (isPlaywrightBrowserMissingError(error)) {
      console.error(formatPlaywrightInstallHint());
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
