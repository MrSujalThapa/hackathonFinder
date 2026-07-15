import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "@/cli/loadEnv";
import { inferDiscoveryBudget } from "@/experiments/scraper-v2/generic/budget";
import { CrawleeRuntime, ExistingCustomRuntime } from "@/experiments/scraper-v2/generic/crawlRuntime";
import { RUNTIME_COMPARISON_SITES, type RuntimeComparisonSite } from "@/experiments/scraper-v2/generic/runtimeComparisonSites";
import { runGenericStructuredExtraction } from "@/experiments/scraper-v2/generic/structuredExtraction";
import type { CrawlRuntime, DiscoveryBudget, GenericStructuredExtractionResult, SourceExperiment } from "@/experiments/scraper-v2/generic/types";

loadLocalEnv();

type RuntimeName = "custom" | "crawlee";
type Profile = DiscoveryBudget["profile"];

const DEFAULT_TRACE_DIR = path.join(".local-audits", "traces", "phase-5-2");

function argValue(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function listArg<T extends string>(name: string, fallback: T[]): T[] {
  const raw = argValue(name);
  if (!raw) return fallback;
  return raw.split(",").map((value) => value.trim()).filter(Boolean) as T[];
}

function numberArg(name: string, fallback: number): number {
  const raw = argValue(name);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function runtimeFor(name: RuntimeName): CrawlRuntime {
  return name === "crawlee" ? new CrawleeRuntime() : new ExistingCustomRuntime();
}

function originVariants(origin: string): string[] {
  const parsed = new URL(origin);
  const host = parsed.hostname;
  const variants = new Set([origin]);
  if (host.startsWith("www.")) {
    variants.add(`${parsed.protocol}//${host.slice(4)}${parsed.port ? `:${parsed.port}` : ""}`);
  } else {
    variants.add(`${parsed.protocol}//www.${host}${parsed.port ? `:${parsed.port}` : ""}`);
  }
  return [...variants];
}

function experimentForSite(site: RuntimeComparisonSite, profile: Profile): SourceExperiment {
  const parsed = new URL(site.url);
  const profileCaps: Record<Profile, { pages: number; requests: number }> = {
    quick: { pages: 3, requests: 12 },
    standard: { pages: 8, requests: 32 },
    deep: { pages: 20, requests: 80 },
    exhaustive: { pages: 40, requests: 160 },
  };
  return {
    inputUrl: parsed.toString(),
    allowedOrigins: [...new Set([...originVariants(parsed.origin), ...(site.allowedOrigins ?? []).flatMap(originVariants)])],
    maxRequests: Math.min(numberArg("--max-requests", profileCaps[profile].requests), profileCaps[profile].requests),
    maxPages: Math.min(numberArg("--max-pages", profileCaps[profile].pages), profileCaps[profile].pages),
    maxPayloadBytes: numberArg("--max-payload-bytes", 5_000_000),
    browserAllowed: argValue("--browser") !== "false",
    expectedContentCategory: "public_event_directory",
    expectedMinimumEventCount: site.expectedMinimumEventCount,
  };
}

function budgetForProfile(profile: Profile): DiscoveryBudget {
  return inferDiscoveryBudget({ query: `${profile} hackathon directory coverage` });
}

function seconds(ms: number | undefined): string {
  return ((ms ?? 0) / 1000).toFixed(1);
}

function pct(value: number | undefined): string {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function markdownEscape(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

async function runOne(input: {
  site: RuntimeComparisonSite;
  runtimeName: RuntimeName;
  profile: Profile;
  traceDir: string;
}): Promise<{ site: RuntimeComparisonSite; runtimeName: RuntimeName; profile: Profile; result?: GenericStructuredExtractionResult; error?: string }> {
  const runtime = runtimeFor(input.runtimeName);
  const budget = budgetForProfile(input.profile);
  try {
    const result = await runGenericStructuredExtraction(experimentForSite(input.site, input.profile), {
      runtime,
      budget,
      checkpointDir: path.join(input.traceDir, "checkpoints"),
    });
    return { site: input.site, runtimeName: input.runtimeName, profile: input.profile, result };
  } catch (error) {
    return {
      site: input.site,
      runtimeName: input.runtimeName,
      profile: input.profile,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resultRow(row: Awaited<ReturnType<typeof runOne>>): string {
  if (!row.result) {
    return `| ${row.site.label} | ${row.profile} | ${row.runtimeName} | error | 0 | 0 | 0 | unknown | unknown | 0% | 0% | 0.0 | ${markdownEscape(row.error ?? "unknown")} |`;
  }
  const result = row.result;
  return [
    row.site.label,
    row.profile,
    row.runtimeName,
    result.quality.classification,
    String(result.acquisition.pagesRequested ?? 1),
    String(result.counters.recordsInspected),
    String(result.quality.validEventLeads),
    String(result.quality.estimatedAvailableRecords ?? "unknown"),
    pct(result.quality.estimatedRecall),
    pct(result.quality.estimatedPrecision),
    pct(result.quality.duplicateRate),
    seconds(result.timings.totalMs),
    markdownEscape(result.acquisition.paginationStopReason ?? "unknown"),
  ].join(" | ").replace(/^/, "| ").replace(/$/, " |");
}

function sampleSection(row: Awaited<ReturnType<typeof runOne>>): string[] {
  if (!row.result) return [`### ${row.site.label} / ${row.profile} / ${row.runtimeName}`, "", `Error: ${row.error ?? "unknown"}`, ""];
  const result = row.result;
  return [
    `### ${row.site.label} / ${row.profile} / ${row.runtimeName}`,
    "",
    `Runtime: ${result.acquisition.runtime ?? row.runtimeName}`,
    `Mode: ${result.acquisitionMode}`,
    `Stop reason: ${result.acquisition.paginationStopReason ?? "unknown"}`,
    `Pagination executed: ${result.acquisition.paginationExecuted ? "yes" : "no"}`,
    `Browser escalated: ${result.acquisition.browserEscalated ? "yes" : "no"}`,
    `Actions: ${result.acquisition.actionsExecuted ?? 0}/${result.acquisition.actionsDiscovered ?? 0}`,
    `Quality: ${result.quality.classification}`,
    `Estimated recall: ${pct(result.quality.estimatedRecall)}`,
    `Precision estimate: ${pct(result.quality.estimatedPrecision)}`,
    "",
    "Lead sample for manual precision review:",
    "",
    ...(result.leads.slice(0, 20).map((lead, index) =>
      `${index + 1}. ${markdownEscape(lead.title)}${lead.canonicalUrl ? ` - ${lead.canonicalUrl}` : ""}`,
    )),
    result.leads.length === 0 ? "No leads extracted." : "",
    "",
  ];
}

async function main(): Promise<void> {
  const traceDir = argValue("--trace-dir") ?? DEFAULT_TRACE_DIR;
  const siteSlugs = listArg<string>("--sites", RUNTIME_COMPARISON_SITES.map((site) => site.slug));
  const profiles = listArg<Profile>("--profiles", ["quick", "standard", "deep"]);
  const runtimes = listArg<RuntimeName>("--runtimes", ["custom", "crawlee"]);
  const sites = RUNTIME_COMPARISON_SITES.filter((site) => siteSlugs.includes(site.slug));
  await mkdir(traceDir, { recursive: true });

  const rows: Awaited<ReturnType<typeof runOne>>[] = [];
  for (const site of sites) {
    for (const profile of profiles) {
      for (const runtimeName of runtimes) {
        console.log(`[phase-5-2] ${site.label} ${profile} ${runtimeName}`);
        rows.push(await runOne({ site, runtimeName, profile, traceDir }));
      }
    }
  }

  const report = [
    "# Phase 5.2 Crawlee Runtime Comparison",
    "",
    `Date: ${new Date().toISOString()}`,
    `Persistence: disabled`,
    "",
    "## Matrix",
    "",
    "| Site | Profile | Runtime | Quality | Pages | Records observed | Valid events | Estimated available | Estimated recall | Precision | Duplicate rate | Duration s | Stop reason |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map(resultRow),
    "",
    "## Held-Out Sites",
    "",
    ...RUNTIME_COMPARISON_SITES.filter((site) => site.heldOut).map((site) => `- ${site.label}: ${site.url}`),
    "",
    "## Precision Samples",
    "",
    ...rows.flatMap(sampleSection),
  ].join("\n");

  await writeFile(path.join(traceDir, "crawlee-runtime-comparison.md"), report, "utf8");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
