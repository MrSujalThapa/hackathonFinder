/**
 * Focused Luma deep probe for theme-metric semantics (live network).
 * Usage: npx tsx scripts/luma-theme-metrics-probe.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnv } from "@/cli/loadEnv";
import { getCollector } from "@/collectors/registry";
import { parseCommand } from "@/agent/parseCommand";
import { buildSourceTelemetry } from "@/discovery/sourceTelemetry";
import type { SourceRunStats } from "@/core/discovery/types";

loadLocalEnv();

const OUT_DIR = resolve(process.cwd(), ".local-audits/traces/a1-a2-thresholds");
const COMMAND = "find AI hackathons in Toronto --profile deep --sources=luma";

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const preferences = {
    ...parseCommand(COMMAND),
    sources: ["luma" as const],
    profile: "deep" as const,
  };
  console.log(`themes=${JSON.stringify(preferences.themes)} command=${preferences.rawCommand}`);

  const collector = getCollector("luma");
  const result = await collector.collect({
    preferences,
    maxResults: preferences.maxResults ?? 200,
    timeoutMs: 240_000,
    logger: (message) => console.log(`[luma/deep] ${message}`),
  });

  const stats: SourceRunStats = {
    source: "luma",
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

  const report = {
    measuredAt: new Date().toISOString(),
    command: COMMAND,
    themes: preferences.themes,
    rawUnique: result.metrics?.uniqueCards ?? result.leads.length,
    feedThemeCandidate: result.metrics?.feedThemeCandidate ?? 0,
    contentThemeMatched: result.metrics?.contentThemeMatched ?? 0,
    themeRelevant: result.metrics?.themeRelevant ?? 0,
    classifiedHackathon: result.metrics?.classifiedHackathon ?? 0,
    queryRelevantEstimate: result.metrics?.queryRelevant ?? 0,
    telemetry,
    sampleContentTheme: result.leads
      .filter((lead) => lead.metadata?.contentThemeMatched === true)
      .slice(0, 10)
      .map((lead) => ({ title: lead.title, url: lead.url })),
    sampleFeedOnly: result.leads
      .filter(
        (lead) =>
          lead.metadata?.feedThemeCandidate === true &&
          lead.metadata?.contentThemeMatched !== true,
      )
      .slice(0, 10)
      .map((lead) => ({
        title: lead.title,
        url: lead.url,
        discoveredFrom: lead.metadata?.discoveredFrom,
      })),
  };

  const out = resolve(OUT_DIR, `luma-theme-metrics-${Date.now()}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({
    rawUnique: report.rawUnique,
    feedThemeCandidate: report.feedThemeCandidate,
    contentThemeMatched: report.contentThemeMatched,
    classifiedHackathon: report.classifiedHackathon,
    queryRelevantEstimate: report.queryRelevantEstimate,
    themeRelevantEqualsContent: report.themeRelevant === report.contentThemeMatched,
    feedNotEqualContent: report.feedThemeCandidate !== report.contentThemeMatched,
  }, null, 2));
  console.log(`Wrote ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
