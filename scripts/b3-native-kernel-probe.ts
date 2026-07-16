/**
 * B3 live parity probes — native collectors on DirectoryCrawlKernel.
 * Usage: npx tsx scripts/b3-native-kernel-probe.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnv } from "@/cli/loadEnv";
import { parseCommand } from "@/agent/parseCommand";
import { getCollector } from "@/collectors/registry";
import type { DiscoveryProfile } from "@/core/discovery/types";

loadLocalEnv();

const OUT_DIR = resolve(process.cwd(), ".local-audits/traces/b3-native-kernel");

async function run(
  source: "devpost" | "luma" | "hakku",
  profile: DiscoveryProfile,
  command: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const preferences = {
    ...parseCommand(command),
    sources: [source],
    profile,
  };
  const started = Date.now();
  const collector = getCollector(source);
  if (!collector) throw new Error(`Missing collector ${source}`);
  const result = await collector.collect({
    preferences,
    maxResults: preferences.maxResults ?? 200,
    timeoutMs,
    dryRun: true,
    logger: (m) => console.log(`[${source}/${profile}] ${m}`),
  });
  const warnings = result.warnings ?? [];
  return {
    source,
    profile,
    durationMs: Date.now() - started,
    listingDurationMs: result.metrics?.listingDurationMs ?? null,
    detailDurationMs: result.metrics?.detailDurationMs ?? null,
    unique: result.metrics?.uniqueCards ?? result.leads.length,
    stopReason:
      warnings.find((w) => w.startsWith("stop_reason="))?.replace("stop_reason=", "") ??
      result.diagnostics.stopReason,
    acquisitionScope:
      warnings.find((w) => w.startsWith("acquisition_scope="))?.replace("acquisition_scope=", "") ??
      null,
    targetReached:
      warnings.find((w) => w.startsWith("target_reached="))?.replace("target_reached=", "") ?? null,
    directoryReportedTotal:
      warnings.find((w) => w.startsWith("directory_reported_total="))?.replace(
        "directory_reported_total=",
        "",
      ) ?? null,
    status: result.status,
    detailPagesOpened: result.metrics?.detailPagesOpened ?? null,
    classifiedHackathon: result.metrics?.classifiedHackathon ?? null,
    feedThemeCandidate: result.metrics?.feedThemeCandidate ?? null,
    contentThemeMatched: result.metrics?.contentThemeMatched ?? null,
    warningSample: warnings.slice(0, 12),
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const runs = {
    measuredAt: new Date().toISOString(),
    kernelNote:
      "B3 — Devpost API + Luma feed growth via DirectoryCrawlKernel; Hakku remains on collectUntilStable",
    devpostLight: await run(
      "devpost",
      "light",
      "find AI hackathons --profile light --sources=devpost",
      90_000,
    ),
    devpostDeep: await run(
      "devpost",
      "deep",
      "find AI hackathons --profile deep --sources=devpost",
      240_000,
    ),
    lumaLight: await run(
      "luma",
      "light",
      "find AI hackathons in Toronto --profile light --sources=luma",
      120_000,
    ),
    lumaDeep: await run(
      "luma",
      "deep",
      "find AI hackathons in Toronto --profile deep --sources=luma",
      300_000,
    ),
    hakku: await run("hakku", "light", "find hackathons --profile light --sources=hakku", 90_000),
  };

  const checks = {
    devpostLight50to100:
      Number(runs.devpostLight.unique) >= 50 && Number(runs.devpostLight.unique) <= 100,
    devpostLightFullDirectory: runs.devpostLight.acquisitionScope === "full_directory_api",
    devpostDeepAtLeast300: Number(runs.devpostDeep.unique) >= 300,
    lumaDeepAtLeast100: Number(runs.lumaDeep.unique) >= 100,
  };
  const report = { ...runs, checks, pass: Object.values(checks).every(Boolean) };
  const out = resolve(OUT_DIR, `parity-${Date.now()}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        checks,
        pass: report.pass,
        totals: {
          devpostLight: runs.devpostLight.unique,
          devpostDeep: runs.devpostDeep.unique,
          lumaLight: runs.lumaLight.unique,
          lumaDeep: runs.lumaDeep.unique,
          hakku: runs.hakku.unique,
          durations: {
            devpostLight: runs.devpostLight.durationMs,
            devpostDeep: runs.devpostDeep.durationMs,
            lumaLight: runs.lumaLight.durationMs,
            lumaDeep: runs.lumaDeep.durationMs,
            hakku: runs.hakku.durationMs,
          },
          listing: {
            devpostLight: runs.devpostLight.listingDurationMs,
            devpostDeep: runs.devpostDeep.listingDurationMs,
          },
          detail: {
            devpostLight: runs.devpostLight.detailDurationMs,
            devpostDeep: runs.devpostDeep.detailDurationMs,
          },
        },
        out,
      },
      null,
      2,
    ),
  );
  if (!report.pass) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
