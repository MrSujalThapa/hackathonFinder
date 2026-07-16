/**
 * A1/A2 product-threshold verification (live network).
 * Runs Devpost light + deep and Luma deep; does not start B1.
 *
 * Usage: npx tsx scripts/a1-a2-threshold-verify.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnv } from "@/cli/loadEnv";
import { getCollector } from "@/collectors/registry";
import { getDefaultDiscoveryPreferences } from "@/agent/parseCommand";
import {
  buildDevpostFullDirectoryApiUrl,
  parseDevpostApiRequestScope,
} from "@/collectors/devpost";
import { resolveLumaFeeds } from "@/collectors/luma";
import { buildSourceTelemetry } from "@/discovery/sourceTelemetry";
import type { DiscoveryProfile, SourceRunStats } from "@/core/discovery/types";

loadLocalEnv();

const OUT_DIR = resolve(process.cwd(), ".local-audits/traces/a1-a2-thresholds");

async function runCollector(
  source: "devpost" | "luma",
  profile: DiscoveryProfile,
  command: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const preferences = {
    ...getDefaultDiscoveryPreferences(command),
    sources: [source],
    profile,
  };
  const collector = getCollector(source);
  const started = Date.now();
  const result = await collector.collect({
    preferences,
    maxResults: preferences.maxResults ?? 200,
    timeoutMs,
    logger: (message) => console.log(`[${source}/${profile}] ${message}`),
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
    outcome:
      result.status === "failed"
        ? "failed"
        : result.status === "degraded"
          ? "degraded"
          : "executed",
  };
  const telemetry = buildSourceTelemetry({ stats, result });

  const perRoute: Array<{ route: string; unique: number; stopReason: string }> = [];
  for (const warning of result.warnings) {
    const uniqueMatch = warning.match(/^unique_cards_(.+)=(\d+)$/);
    if (uniqueMatch) {
      const route = uniqueMatch[1]!;
      const unique = Number(uniqueMatch[2]);
      const stop = result.warnings.find((w) => w.startsWith(`stop_reason_${route}=`));
      perRoute.push({
        route,
        unique,
        stopReason: stop?.slice(`stop_reason_${route}=`.length) ?? "unknown",
      });
    }
  }

  const sample = result.leads.slice(0, 8).map((lead) => ({
    title: lead.title,
    url: lead.url,
    startDate: lead.metadata?.startDate ?? lead.metadata?.dateText ?? null,
  }));

  return {
    source,
    profile,
    durationMs: Date.now() - started,
    status: result.status,
    leads: result.leads.length,
    diagnostics: result.diagnostics,
    metrics: result.metrics ?? null,
    telemetry,
    perRoute,
    sample,
    listingDurationMs: result.metrics?.listingDurationMs ?? null,
    detailDurationMs: result.metrics?.detailDurationMs ?? null,
    detailPagesOpened: result.metrics?.detailPagesOpened ?? null,
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log("=== A1/A2 product threshold verification ===");

  const page1 = await fetch(buildDevpostFullDirectoryApiUrl(1), {
    headers: { accept: "application/json" },
  }).then((r) => r.json());
  const directoryReportedTotal = Number(page1?.meta?.total_count ?? 0);
  const acquisitionScope = parseDevpostApiRequestScope(buildDevpostFullDirectoryApiUrl(1));
  console.log(
    `Devpost directory scope=${acquisitionScope} reportedTotal=${directoryReportedTotal}`,
  );

  const light = await runCollector(
    "devpost",
    "light",
    "find AI hackathons --profile light --sources=devpost",
    60_000,
  );
  console.log(
    `Devpost light unique=${light.leads} durationMs=${light.durationMs} stop=${(light.diagnostics as { stopReason?: string }).stopReason} details=${light.detailPagesOpened}`,
  );

  const deep = await runCollector(
    "devpost",
    "deep",
    "find AI hackathons --profile deep --sources=devpost",
    180_000,
  );
  console.log(
    `Devpost deep unique=${deep.leads} durationMs=${deep.durationMs} stop=${(deep.diagnostics as { stopReason?: string }).stopReason} details=${deep.detailPagesOpened}`,
  );

  const feeds = resolveLumaFeeds({
    requestedLocation: "toronto",
    requestedTopics: ["AI"],
    rawCommand: "find AI hackathons in Toronto --profile deep",
  });
  console.log(
    `Luma routes (${feeds.feeds.length}): ${feeds.feeds.map((f) => f.label).join(" | ")}`,
  );

  const luma = await runCollector(
    "luma",
    "deep",
    "find AI hackathons in Toronto --profile deep --sources=luma",
    240_000,
  );
  console.log(
    `Luma deep unique=${luma.leads} classified=${(luma.metrics as { classifiedHackathon?: number } | null)?.classifiedHackathon} routes=${JSON.stringify(luma.perRoute)}`,
  );

  const lightUnique = Number(light.leads);
  const deepUnique = Number(deep.leads);
  const lumaUnique = Number(luma.leads);
  const lightStop = String((light.diagnostics as { stopReason?: string }).stopReason ?? "");
  const deepStop = String((deep.diagnostics as { stopReason?: string }).stopReason ?? "");
  const lightDetails = Number(light.detailPagesOpened ?? 0);
  const deepDetails = Number(deep.detailPagesOpened ?? 0);
  const lightTelemetry = light.telemetry as {
    acquisitionScope?: string;
    directoryReportedTotal?: number;
    targetForProfile?: number;
    targetReached?: boolean;
    listingDurationMs?: number;
    detailDurationMs?: number;
  };
  const deepTelemetry = deep.telemetry as {
    acquisitionScope?: string;
    directoryReportedTotal?: number;
    targetForProfile?: number;
    targetReached?: boolean;
    listingDurationMs?: number;
    detailDurationMs?: number;
  };

  const perRoute = (luma.perRoute as Array<{ route: string; unique: number; stopReason: string }>) ?? [];
  const starved = perRoute.some((r) => /timeout_before_start/i.test(r.stopReason));
  const allRoutesHaveStop = perRoute.length > 0 && perRoute.every((r) => Boolean(r.stopReason));

  const checks = {
    devpostLightInRange: lightUnique >= 50 && lightUnique <= 100,
    devpostDeepAtLeast300: deepUnique >= 300,
    profileBudgetsDiffer: deepUnique > lightUnique,
    lightStopIsTargetOrNoGrowth:
      /target_reached|no_additional_cards|no_next_page/i.test(lightStop),
    deepStopIsBudgetOrContinue:
      /maximum_cards_reached|maximum_pages_reached|no_additional_cards|no_next_page|target_reached/i.test(
        deepStop,
      ),
    listingBeforeDetail:
      Number(deepTelemetry.listingDurationMs ?? 0) > 0 &&
      Number(deepTelemetry.detailDurationMs ?? 0) >= 0 &&
      Number(lightDetails) <= 12,
    acquisitionScopeFullDirectory:
      deepTelemetry.acquisitionScope === "full_directory_api" &&
      (deepTelemetry.directoryReportedTotal ?? directoryReportedTotal) > 166,
    lumaDeepAtLeast100: lumaUnique >= 100,
    lumaPerRouteStops: allRoutesHaveStop && !starved,
  };

  const passed = Object.values(checks).every(Boolean);

  const report = {
    measuredAt: new Date().toISOString(),
    acquisitionScope,
    directoryReportedTotal,
    devpostLight: {
      unique: lightUnique,
      durationMs: light.durationMs,
      listingDurationMs: light.listingDurationMs,
      detailDurationMs: light.detailDurationMs,
      detailPagesOpened: lightDetails,
      stopReason: lightStop,
      telemetry: light.telemetry,
    },
    devpostDeep: {
      unique: deepUnique,
      durationMs: deep.durationMs,
      listingDurationMs: deep.listingDurationMs,
      detailDurationMs: deep.detailDurationMs,
      detailPagesOpened: deepDetails,
      stopReason: deepStop,
      telemetry: deep.telemetry,
    },
    lumaDeep: {
      unique: lumaUnique,
      durationMs: luma.durationMs,
      detailPagesOpened: luma.detailPagesOpened,
      classifiedHackathon: (luma.metrics as { classifiedHackathon?: number } | null)
        ?.classifiedHackathon,
      themeRelevant: (luma.metrics as { themeRelevant?: number } | null)?.themeRelevant,
      perRoute,
      sample: luma.sample,
      telemetry: luma.telemetry,
    },
    checks,
    thresholdsPassed: passed,
  };

  const out = resolve(OUT_DIR, `threshold-verify-${Date.now()}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log(`Wrote ${out}`);
  console.log(`THRESHOLDS: ${passed ? "PASS" : "FAIL"}`);
  console.log(JSON.stringify(checks, null, 2));
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
