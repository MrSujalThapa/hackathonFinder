/**
 * Deep full-directory recall probe for Devpost + Luma (live network).
 * Usage: npx tsx scripts/full-directory-recall-probe.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnv } from "@/cli/loadEnv";
import { getCollector } from "@/collectors/registry";
import { getDefaultDiscoveryPreferences } from "@/agent/parseCommand";
import {
  buildDevpostFullDirectoryApiUrl,
  buildDevpostOpenUpcomingApiUrl,
  parseDevpostApiPayload,
  parseDevpostApiRequestScope,
} from "@/collectors/devpost";
import { resolveLumaFeeds } from "@/collectors/luma";
import { buildSourceTelemetry } from "@/discovery/sourceTelemetry";
import type { SourceRunStats } from "@/core/discovery/types";

loadLocalEnv();

const OUT_DIR = resolve(process.cwd(), ".local-audits/traces/full-directory-recall");

async function compareApiScopes(): Promise<Record<string, unknown>> {
  const full = await fetch(buildDevpostFullDirectoryApiUrl(1), {
    headers: { accept: "application/json" },
  }).then((r) => r.json());
  const subset = await fetch(buildDevpostOpenUpcomingApiUrl(1), {
    headers: { accept: "application/json" },
  }).then((r) => r.json());
  return {
    fullDirectory: {
      scope: parseDevpostApiRequestScope(buildDevpostFullDirectoryApiUrl(1)),
      meta: full.meta,
      pageCards: full.hackathons?.length ?? 0,
      sampleStatuses: (full.hackathons ?? [])
        .slice(0, 9)
        .map((h: { open_state?: string }) => h.open_state),
    },
    openUpcomingSubset: {
      scope: parseDevpostApiRequestScope(buildDevpostOpenUpcomingApiUrl(1)),
      meta: subset.meta,
      pageCards: subset.hackathons?.length ?? 0,
    },
  };
}

async function runCollector(
  source: "devpost" | "luma",
  command: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const preferences = {
    ...getDefaultDiscoveryPreferences(command),
    sources: [source],
    profile: "deep" as const,
  };
  const collector = getCollector(source);
  const started = Date.now();
  const result = await collector.collect({
    preferences,
    maxResults: preferences.maxResults ?? 200,
    timeoutMs,
    logger: (message) => console.log(`[${source}] ${message}`),
  });
  const stats: SourceRunStats = {
    source,
    leadsFound: result.leads.length,
    queueReady: 0,
    needsReview: 0,
    invalidRejected: 0,
    accepted: 0,
    rejected: 0,
    errors: result.errors,
    warnings: result.warnings,
    durationMs: result.durationMs,
    outcome: result.status === "failed" ? "failed" : result.status === "degraded" ? "degraded" : "executed",
  };
  const telemetry = buildSourceTelemetry({ stats, result });
  const sampleTitles = result.leads.slice(0, 30).map((lead) => lead.title ?? lead.url);
  return {
    source,
    durationMs: Date.now() - started,
    status: result.status,
    leads: result.leads.length,
    diagnostics: result.diagnostics,
    metrics: result.metrics ?? null,
    telemetry,
    sampleTitles,
    warningKeys: result.warnings
      .filter((w) => /^(acquisition_scope|stop_|status_|classified_|theme_|unique_|meta_)/.test(w))
      .slice(0, 40),
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log("=== Full-directory recall probe ===");

  const apiScopes = await compareApiScopes();
  console.log(JSON.stringify(apiScopes, null, 2));

  const feeds = resolveLumaFeeds({
    requestedLocation: "toronto",
    requestedTopics: ["AI"],
    rawCommand: "find AI hackathons in Toronto --profile deep",
  });
  console.log(
    `Luma routes (${feeds.feeds.length}): ${feeds.feeds.map((f) => f.label).join(" | ")}`,
  );

  // Generous timeouts so deep listing is not truncated by the probe harness.
  const devpost = await runCollector(
    "devpost",
    "find AI hackathons --profile deep --sources=devpost",
    180_000,
  );
  console.log(
    `Devpost unique=${devpost.leads} scope=${(devpost.telemetry as { acquisitionScope?: string }).acquisitionScope} stop=${(devpost.diagnostics as { stopReason?: string }).stopReason}`,
  );

  const luma = await runCollector(
    "luma",
    "find AI hackathons in Toronto --profile deep --sources=luma",
    240_000,
  );
  console.log(
    `Luma unique=${luma.leads} classified=${(luma.metrics as { classifiedHackathon?: number } | null)?.classifiedHackathon} stop=${(luma.diagnostics as { stopReason?: string }).stopReason}`,
  );

  const report = {
    measuredAt: new Date().toISOString(),
    growthMechanism:
      "Browser scrolling https://devpost.com/hackathons issues GET /api/hackathons?page=N without status filters; meta.total_count ≈ 13601.",
    whyA0StoppedAt18:
      "A0 scrolled the status-filtered HTML URL and counted DOM tiles that virtualize; it never followed unfiltered API pagination.",
    whyApiStoppedAt166:
      "Collector previously requested only status[]=open&status[]=upcoming, whose meta.total_count is 166.",
    apiScopes,
    lumaRoutes: feeds.feeds,
    deepDevpost: devpost,
    deepLuma: luma,
    hundredsScale: {
      devpostUnique: Number(devpost.leads),
      lumaUnique: Number(luma.leads),
      devpostGate: Number(devpost.leads) >= 300 ? "pass" : "fail",
      lumaGate: Number(luma.leads) >= 100 ? "pass" : "fail_or_prove_no_growth",
    },
  };

  const out = resolve(OUT_DIR, `deep-recall-${Date.now()}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log(`Wrote ${out}`);

  // Keep a tiny parse sanity check using live page-1 payload.
  const page1 = await fetch(buildDevpostFullDirectoryApiUrl(1), {
    headers: { accept: "application/json" },
  }).then((r) => r.json());
  const parsed = parseDevpostApiPayload(page1, 50, { includeEnded: true });
  console.log(`parse sanity page1 leads=${parsed.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
