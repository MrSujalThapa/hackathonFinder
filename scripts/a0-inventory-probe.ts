/**
 * A0 measurement probe — inventory + telemetry payload sizes only.
 * Does not change production scrape routing or persistence.
 *
 * Usage: npx tsx scripts/a0-inventory-probe.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnv } from "@/cli/loadEnv";
import {
  buildDevpostApiUrl,
  buildDevpostListingsUrl,
  canonicalizeDevpostUrl,
  parseDevpostApiPayload,
  parseDevpostHtml,
} from "@/collectors/devpost";
import {
  isLikelyHackathon,
  parseLumaHtml,
  resolveLumaFeeds,
  type LumaDiscoveryFeed,
} from "@/collectors/luma";
import type { SourceRunStats } from "@/core/discovery/types";
import {
  buildSourceTelemetry,
  compactSourceStatsForSummary,
  estimateJsonBytes,
  legacySourceStatsPayload,
} from "@/discovery/sourceTelemetry";
import { collectUntilStable } from "@/lib/browser/collectUntilStable";
import {
  formatPlaywrightInstallHint,
  isPlaywrightBrowserMissingError,
  withPlaywright,
} from "@/lib/browser/playwright";
import { normalizeUrlForDedupe } from "@/lib/http/url";

loadLocalEnv();

const OUT_DIR = resolve(process.cwd(), ".local-audits/traces/a0");
const REPORT_JSON = resolve(OUT_DIR, "inventory-probe.json");

type InventoryEstimate = {
  value: number;
  method: "api_total" | "pagination_derived" | "scroll_plateau" | "unknown";
  confidence: "strong" | "moderate" | "weak";
};

type DevpostApiProbe = {
  metaTotalCount: number | null;
  pagesFetched: number;
  collectedRaw: number;
  collectedUnique: number;
  statuses: Record<string, number>;
  stopReason: string;
  inventory: InventoryEstimate;
  sampleUrls: string[];
};

type DevpostRenderedProbe = {
  finalUrl: string;
  collectedRaw: number;
  collectedUnique: number;
  /** UI time-left labels on tiles (not API open_state). */
  timeLeftLabels: Record<string, number>;
  /** open/upcoming inferred from filtered listing URL params when present. */
  representedFilterStatuses: string[];
  scrollAttempts: number;
  stopReason: string;
  inventory: InventoryEstimate;
  sampleUrls: string[];
};

type OverlapProbe = {
  apiOnly: number;
  renderedOnly: number;
  intersection: number;
  apiUnique: number;
  renderedUnique: number;
};

type LumaFeedProbe = {
  feed: string;
  label: string;
  url: string;
  /** Unique event hrefs from the feed DOM (pre-parser). */
  rawLinkUnique: number;
  /** Unique leads after parseLumaHtml (collector-visible before scoring). */
  parsedUnique: number;
  /** isLikelyHackathon on parsed leads (cheap relevance, not pipeline scoring). */
  hackathonIntent: number;
  scrollAttempts: number;
  stopReason: string;
  inventory: InventoryEstimate;
};

async function fetchDevpostApiInventory(maxPages = 200): Promise<{
  probe: DevpostApiProbe;
  urls: Set<string>;
}> {
  const urls = new Set<string>();
  const statuses: Record<string, number> = {};
  let pagesFetched = 0;
  let collectedRaw = 0;
  let metaTotalCount: number | null = null;
  let stopReason = "max_pages";

  for (let page = 1; page <= maxPages; page += 1) {
    const requestedUrl = buildDevpostApiUrl(page);
    const response = await fetch(requestedUrl, {
      headers: { accept: "application/json, text/plain, */*" },
    });
    pagesFetched += 1;
    if (!response.ok) {
      stopReason = `http_${response.status}`;
      break;
    }
    const payload = (await response.json()) as {
      hackathons?: Array<{ open_state?: string; url?: string; title?: string }>;
      meta?: { total_count?: number; per_page?: number };
    };
    if (typeof payload.meta?.total_count === "number") {
      metaTotalCount = payload.meta.total_count;
    }
    const leads = parseDevpostApiPayload(payload as never, 10_000);
    collectedRaw += (payload.hackathons ?? []).length;
    for (const item of payload.hackathons ?? []) {
      const status = (item.open_state ?? "unknown").trim() || "unknown";
      statuses[status] = (statuses[status] ?? 0) + 1;
    }
    for (const lead of leads) {
      const key = canonicalizeDevpostUrl(lead.url ?? "") ?? lead.url;
      if (key) urls.add(normalizeUrlForDedupe(key));
    }
    const perPage = payload.meta?.per_page ?? (payload.hackathons ?? []).length;
    const hasNext =
      typeof metaTotalCount === "number"
        ? page * Math.max(perPage, 1) < metaTotalCount
        : (payload.hackathons ?? []).length > 0;
    if (!hasNext || (payload.hackathons ?? []).length === 0) {
      stopReason = "no_next_page";
      break;
    }
  }

  const value = metaTotalCount ?? urls.size;
  return {
    urls,
    probe: {
      metaTotalCount,
      pagesFetched,
      collectedRaw,
      collectedUnique: urls.size,
      statuses,
      stopReason,
      inventory: {
        value,
        method: metaTotalCount != null ? "api_total" : "pagination_derived",
        confidence: metaTotalCount != null ? "strong" : "moderate",
      },
      sampleUrls: [...urls].slice(0, 8),
    },
  };
}

async function fetchDevpostRenderedInventory(): Promise<{
  probe: DevpostRenderedProbe;
  urls: Set<string>;
}> {
  const listingUrl = buildDevpostListingsUrl(1);
  return withPlaywright(async ({ page }) => {
    await page.goto(listingUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page
      .locator("a.tile-anchor")
      .first()
      .waitFor({ state: "attached", timeout: 15_000 })
      .catch(() => undefined);

    type Card = { url: string; status: string };
    const collected = await collectUntilStable<Card>({
      collectItems: async () =>
        page.locator("a.tile-anchor").evaluateAll((anchors) =>
          anchors.map((anchor) => {
            const el = anchor as HTMLAnchorElement;
            const status =
              el.querySelector(".status-label, .hackathon-status")?.textContent?.trim() ||
              "unknown";
            return { url: el.href, status };
          }),
        ),
      getKey: (card) => normalizeUrlForDedupe(card.url),
      scroll: async () => {
        await page.mouse.wheel(0, 2800).catch(() => undefined);
      },
      waitForIdle: async () => {
        await page.waitForLoadState("networkidle", { timeout: 1_200 }).catch(() => undefined);
      },
      maxItems: 2_000,
      maxScrolls: 80,
      noGrowthLimit: 3,
      timeoutMs: 120_000,
      waitMs: 900,
      logger: (message) => console.log(`[devpost-rendered] ${message}`),
    });

    const urls = new Set<string>();
    const timeLeftLabels: Record<string, number> = {};
    for (const card of collected.items) {
      const key = canonicalizeDevpostUrl(card.url) ?? card.url;
      if (!key) continue;
      urls.add(normalizeUrlForDedupe(key));
      const label = card.status.trim() || "unknown";
      timeLeftLabels[label] = (timeLeftLabels[label] ?? 0) + 1;
    }

    // Confirm parser sees the same card set on final HTML (open/ended filtering applied).
    const html = await page.content();
    parseDevpostHtml(html, 2_000);

    let representedFilterStatuses: string[] = [];
    try {
      representedFilterStatuses = new URL(page.url()).searchParams.getAll("status[]");
    } catch {
      representedFilterStatuses = [];
    }

    const stopMapped =
      collected.stopReason === "no_growth"
        ? "no_additional_cards"
        : collected.stopReason === "max_scrolls"
          ? "maximum_scrolls_reached"
          : collected.stopReason === "max_items"
            ? "maximum_cards_reached"
            : collected.stopReason;

    return {
      urls,
      probe: {
        finalUrl: page.url(),
        collectedRaw: collected.items.length,
        collectedUnique: urls.size,
        timeLeftLabels,
        representedFilterStatuses,
        scrollAttempts: collected.scrollAttempts,
        stopReason: stopMapped,
        inventory: {
          value: urls.size,
          method: stopMapped === "no_additional_cards" ? "scroll_plateau" : "unknown",
          confidence: stopMapped === "no_additional_cards" ? "strong" : "weak",
        },
        sampleUrls: [...urls].slice(0, 8),
      },
    };
  }, { timeoutMs: 150_000 });
}

function overlap(api: Set<string>, rendered: Set<string>): OverlapProbe {
  let intersection = 0;
  for (const url of api) if (rendered.has(url)) intersection += 1;
  return {
    apiOnly: api.size - intersection,
    renderedOnly: rendered.size - intersection,
    intersection,
    apiUnique: api.size,
    renderedUnique: rendered.size,
  };
}

async function probeLumaFeed(feed: {
  mode: string;
  label: string;
  url: string;
}): Promise<LumaFeedProbe> {
  return withPlaywright(async ({ page }) => {
    await page.goto(feed.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page
      .locator("a.event-link[href], a.content-link[href]")
      .first()
      .waitFor({ state: "attached", timeout: 10_000 })
      .catch(() => undefined);
    await page.waitForTimeout(400);

    type Item = { url: string; title: string; text: string; via: "dom" | "parsed" };
    const parsedByUrl = new Map<string, { title: string; text: string }>();
    const collected = await collectUntilStable<Item>({
      collectItems: async () => {
        const html = await page.content();
        const parsed = parseLumaHtml(html, 400, page.url(), feed.mode as LumaDiscoveryFeed);
        for (const lead of parsed) {
          if (!lead.url) continue;
          const key = normalizeUrlForDedupe(lead.url);
          parsedByUrl.set(key, {
            title: lead.title ?? "Luma event",
            text: lead.text ?? lead.title ?? "",
          });
        }
        const domUrls = await page
          .locator("a.event-link[href], a.content-link[href]")
          .evaluateAll((anchors) =>
            anchors.map((anchor) => (anchor as HTMLAnchorElement).href).filter(Boolean),
          );
        const items: Item[] = [];
        for (const url of domUrls) {
          const key = normalizeUrlForDedupe(url);
          const parsedMeta = parsedByUrl.get(key);
          items.push({
            url,
            title: parsedMeta?.title ?? "Luma event",
            text: parsedMeta?.text ?? "",
            via: parsedMeta ? "parsed" : "dom",
          });
        }
        return items;
      },
      getKey: (item) => normalizeUrlForDedupe(item.url),
      scroll: async () => {
        await page.mouse.wheel(0, 2_400);
      },
      waitForIdle: async () => {
        await page.waitForLoadState("networkidle", { timeout: 1_000 }).catch(() => undefined);
      },
      maxItems: 400,
      maxScrolls: 40,
      noGrowthLimit: 3,
      timeoutMs: 90_000,
      waitMs: 800,
      logger: (message) => console.log(`[luma:${feed.label}] ${message}`),
    });

    const parsedUnique = parsedByUrl.size;
    const hackathonIntent = [...parsedByUrl.values()].filter((item) =>
      isLikelyHackathon(item.title, item.text),
    ).length;
    const stopMapped =
      collected.stopReason === "no_growth"
        ? "no_growth"
        : collected.stopReason === "max_scrolls"
          ? "maximum_scrolls_reached"
          : collected.stopReason;

    return {
      feed: feed.mode,
      label: feed.label,
      url: feed.url,
      rawLinkUnique: collected.uniqueCount,
      parsedUnique,
      hackathonIntent,
      scrollAttempts: collected.scrollAttempts,
      stopReason: stopMapped,
      inventory: {
        value: collected.uniqueCount,
        method: stopMapped === "no_growth" ? "scroll_plateau" : "unknown",
        confidence: stopMapped === "no_growth" ? "strong" : "weak",
      },
    };
  }, { timeoutMs: 120_000 });
}

function payloadSizeDemo(): {
  beforeBytes: number;
  afterBytes: number;
  reductionPct: number;
  sampleAfter: Array<Record<string, unknown>>;
} {
  const noisy: SourceRunStats[] = [
    {
      source: "devpost",
      leadsFound: 40,
      queueReady: 10,
      needsReview: 2,
      invalidRejected: 8,
      accepted: 12,
      rejected: 8,
      durationMs: 45_000,
      outcome: "executed",
      warnings: Array.from({ length: 24 }, (_, i) =>
        `page-fingerprint dump ${i} ${"x".repeat(120)}`,
      ),
      errors: ["transient network"],
    },
    {
      source: "luma",
      leadsFound: 55,
      queueReady: 3,
      needsReview: 4,
      invalidRejected: 20,
      accepted: 7,
      rejected: 20,
      durationMs: 90_000,
      outcome: "degraded",
      warnings: Array.from({ length: 18 }, (_, i) =>
        `stop_reason_luma_ai=no_growth fingerprint ${i} ${"y".repeat(90)}`,
      ),
      errors: [],
    },
  ];
  for (const row of noisy) {
    row.telemetry = buildSourceTelemetry({
      stats: row,
      result: {
        source: row.source,
        status: row.outcome === "degraded" ? "degraded" : "completed",
        leads: [],
        warnings: row.warnings,
        errors: row.errors,
        durationMs: row.durationMs,
        diagnostics: {
          discovered: row.leadsFound,
          returned: row.leadsFound,
          enriched: 0,
          partial: 0,
          dropped: 0,
          stopReason: row.source === "devpost" ? "no_next_page" : "no_growth",
        },
        metrics: {
          uniqueCards: row.leadsFound,
          pagesFetched: row.source === "devpost" ? 18 : 4,
          scrollAttempts: row.source === "luma" ? 36 : 0,
        },
      },
    });
  }
  const beforeBytes = estimateJsonBytes(legacySourceStatsPayload(noisy));
  const after = compactSourceStatsForSummary(noisy);
  const afterBytes = estimateJsonBytes(after);
  return {
    beforeBytes,
    afterBytes,
    reductionPct: Number((((beforeBytes - afterBytes) / beforeBytes) * 100).toFixed(1)),
    sampleAfter: after,
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log("=== A0 inventory probe ===");

  const api = await fetchDevpostApiInventory();
  console.log(
    `Devpost API open+upcoming: meta=${api.probe.metaTotalCount} unique=${api.probe.collectedUnique} pages=${api.probe.pagesFetched} stop=${api.probe.stopReason}`,
  );

  let rendered: Awaited<ReturnType<typeof fetchDevpostRenderedInventory>> | null = null;
  const lumaFeeds: LumaFeedProbe[] = [];
  try {
    rendered = await fetchDevpostRenderedInventory();
    console.log(
      `Devpost rendered open+upcoming: unique=${rendered.probe.collectedUnique} scrolls=${rendered.probe.scrollAttempts} stop=${rendered.probe.stopReason}`,
    );
    console.log(
      `Devpost rendered filter statuses: ${JSON.stringify(rendered.probe.representedFilterStatuses)}`,
    );
    console.log(
      `Devpost rendered time-left labels: ${JSON.stringify(rendered.probe.timeLeftLabels)}`,
    );

    const feeds = resolveLumaFeeds({
      requestedLocation: "toronto",
      requestedTopics: ["AI"],
      rawCommand: "find AI hackathons in Toronto",
    }).feeds;
    for (const feed of feeds) {
      const probe = await probeLumaFeed(feed);
      lumaFeeds.push(probe);
      console.log(
        `Luma ${probe.label}: rawLinks=${probe.rawLinkUnique} parsed=${probe.parsedUnique} hackathon-intent=${probe.hackathonIntent} scrolls=${probe.scrollAttempts} stop=${probe.stopReason}`,
      );
    }
  } catch (error) {
    if (isPlaywrightBrowserMissingError(error)) {
      console.error(formatPlaywrightInstallHint());
    }
    console.error(error);
  }

  const overlapResult =
    rendered != null ? overlap(api.urls, rendered.urls) : null;
  const payload = payloadSizeDemo();

  const report = {
    measuredAt: new Date().toISOString(),
    benchmarkDirectoryLockedForB2: "https://taikai.network/hackathons",
    devpostApiOpenUpcoming: api.probe,
    devpostRenderedOpenUpcoming: rendered?.probe ?? null,
    apiVsRenderedOverlap: overlapResult,
    lumaPerFeedBeforeRelevance: lumaFeeds,
    note:
      "queryRelevant pipeline counts are filled by existing scoring (accepted = queueReady + needsReview), measured separately via dry-run — not by this inventory probe.",
    eventPayloadSourceStats: payload,
  };

  writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nWrote ${REPORT_JSON}`);
  console.log(
    `sourceStats payload: before=${payload.beforeBytes}B after=${payload.afterBytes}B (−${payload.reductionPct}%)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
