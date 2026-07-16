/**
 * B1 live parity probes (Devpost light/deep, Luma light/deep).
 * Does not change routing. Usage: npx tsx scripts/b1-parity-probe.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnv } from "@/cli/loadEnv";
import { parseCommand } from "@/agent/parseCommand";
import { getCollector } from "@/collectors/registry";
import type { DiscoveryProfile } from "@/core/discovery/types";

loadLocalEnv();

const OUT_DIR = resolve(process.cwd(), ".local-audits/traces/b1-kernel");

async function run(
  source: "devpost" | "luma",
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
  return {
    source,
    profile,
    durationMs: Date.now() - started,
    listingDurationMs: result.metrics?.listingDurationMs ?? null,
    detailDurationMs: result.metrics?.detailDurationMs ?? null,
    unique: result.metrics?.uniqueCards ?? result.leads.length,
    stopReason: result.diagnostics.stopReason,
    status: result.status,
    classifiedHackathon: result.metrics?.classifiedHackathon ?? null,
    feedThemeCandidate: result.metrics?.feedThemeCandidate ?? null,
    contentThemeMatched: result.metrics?.contentThemeMatched ?? null,
    detailPagesOpened: result.metrics?.detailPagesOpened ?? null,
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const runs = {
    measuredAt: new Date().toISOString(),
    kernelNote: "B1 extraction — collectors use @/crawl collectUntilStable; API paths unchanged",
    devpostLight: await run("devpost", "light", "find AI hackathons --profile light --sources=devpost", 60_000),
    devpostDeep: await run("devpost", "deep", "find AI hackathons --profile deep --sources=devpost", 180_000),
    lumaLight: await run("luma", "light", "find AI hackathons in Toronto --profile light --sources=luma", 90_000),
    lumaDeep: await run("luma", "deep", "find AI hackathons in Toronto --profile deep --sources=luma", 240_000),
  };

  const checks = {
    devpostLightApprox75:
      Number(runs.devpostLight.unique) >= 50 && Number(runs.devpostLight.unique) <= 100,
    devpostDeepAtLeast300: Number(runs.devpostDeep.unique) >= 300,
    lumaDeepAtLeast100: Number(runs.lumaDeep.unique) >= 100,
  };
  const report = { ...runs, checks, pass: Object.values(checks).every(Boolean) };
  const out = resolve(OUT_DIR, `parity-${Date.now()}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ checks, pass: report.pass, totals: {
    devpostLight: runs.devpostLight.unique,
    devpostDeep: runs.devpostDeep.unique,
    lumaLight: runs.lumaLight.unique,
    lumaDeep: runs.lumaDeep.unique,
    durations: {
      devpostLight: runs.devpostLight.durationMs,
      devpostDeep: runs.devpostDeep.durationMs,
      lumaLight: runs.lumaLight.durationMs,
      lumaDeep: runs.lumaDeep.durationMs,
    },
  } }, null, 2));
  console.log(`Wrote ${out}`);
  if (!report.pass) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
