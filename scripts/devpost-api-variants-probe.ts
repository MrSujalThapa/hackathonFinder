/**
 * Probe Devpost /api/hackathons query variants (no browser).
 * Usage: npx tsx scripts/devpost-api-variants-probe.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT_DIR = resolve(process.cwd(), ".local-audits/traces/full-directory-recall");

async function tryUrl(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const json = (await response.json().catch(() => null)) as {
    hackathons?: Array<{ title?: string; url?: string; open_state?: string }>;
    meta?: { total_count?: number; per_page?: number };
  } | null;
  const statuses: Record<string, number> = {};
  for (const item of json?.hackathons ?? []) {
    const status = item.open_state ?? "unknown";
    statuses[status] = (statuses[status] ?? 0) + 1;
  }
  return {
    url,
    httpStatus: response.status,
    cardCount: json?.hackathons?.length ?? null,
    meta: json?.meta ?? null,
    statuses,
    sample: (json?.hackathons ?? []).slice(0, 3).map((item) => ({
      title: item.title,
      url: item.url,
      open_state: item.open_state,
    })),
  };
}

async function exhaustUnfiltered(maxPages: number): Promise<Record<string, unknown>> {
  const urls = new Set<string>();
  const statuses: Record<string, number> = {};
  let pages = 0;
  let totalCount: number | null = null;
  let stopReason = "max_pages";
  const cardsPerPage: number[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const url = `https://devpost.com/api/hackathons?page=${page}`;
    const response = await fetch(url, { headers: { accept: "application/json" } });
    pages += 1;
    if (!response.ok) {
      stopReason = `http_${response.status}`;
      break;
    }
    const json = (await response.json()) as {
      hackathons?: Array<{ url?: string; open_state?: string }>;
      meta?: { total_count?: number; per_page?: number };
    };
    if (typeof json.meta?.total_count === "number") totalCount = json.meta.total_count;
    const batch = json.hackathons ?? [];
    cardsPerPage.push(batch.length);
    let added = 0;
    for (const item of batch) {
      const status = item.open_state ?? "unknown";
      statuses[status] = (statuses[status] ?? 0) + 1;
      if (!item.url) continue;
      const key = item.url.replace(/\/$/, "");
      if (!urls.has(key)) {
        urls.add(key);
        added += 1;
      }
    }
    const perPage = json.meta?.per_page ?? batch.length;
    const hasNext =
      typeof totalCount === "number"
        ? page * Math.max(perPage, 1) < totalCount
        : batch.length > 0;
    if (batch.length === 0) {
      stopReason = "empty_page";
      break;
    }
    if (!hasNext) {
      stopReason = "no_next_page";
      break;
    }
    if (page % 25 === 0) {
      console.log(`page=${page} unique=${urls.size} added=${added} total_count=${totalCount}`);
    }
    // For this probe stop once we prove hundreds-scale (deep success gate)
    if (urls.size >= 400) {
      stopReason = "probe_target_reached";
      break;
    }
  }

  return {
    scope: "full_directory_api_unfiltered",
    pagesFetched: pages,
    uniqueCards: urls.size,
    metaTotalCount: totalCount,
    statuses,
    cardsPerPage: cardsPerPage.slice(0, 40),
    stopReason,
    sampleUrls: [...urls].slice(0, 20),
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const variants = [
    "https://devpost.com/api/hackathons?page=1",
    "https://devpost.com/api/hackathons?status[]=open&page=1",
    "https://devpost.com/api/hackathons?status[]=upcoming&page=1",
    "https://devpost.com/api/hackathons?status[]=ended&page=1",
    "https://devpost.com/api/hackathons?order_by=recently-added&page=1",
    "https://devpost.com/api/hackathons?status[]=open&status[]=upcoming&page=1",
    "https://devpost.com/api/hackathons?status[]=open&status[]=upcoming&status[]=ended&page=1",
  ];
  const results = [];
  for (const url of variants) {
    const row = await tryUrl(url);
    results.push(row);
    console.log(
      `${url} → count=${row.cardCount} total=${(row.meta as { total_count?: number } | null)?.total_count} statuses=${JSON.stringify(row.statuses)}`,
    );
  }

  console.log("\nExhausting unfiltered API until ≥400 unique…");
  const exhaust = await exhaustUnfiltered(80);
  console.log(JSON.stringify(exhaust, null, 2));

  const out = resolve(OUT_DIR, `devpost-api-variants-${Date.now()}.json`);
  writeFileSync(out, JSON.stringify({ measuredAt: new Date().toISOString(), variants: results, exhaust }, null, 2));
  console.log(`Wrote ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
