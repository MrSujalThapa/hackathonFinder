import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "@/cli/loadEnv";
import { runAdaptiveCrawl, type AdaptiveCrawlResult } from "@/experiments/scraper-v2/generic/adaptiveCrawler";
import { buildCrawlPlan } from "@/experiments/scraper-v2/generic/adaptiveProfiles";
import { RUNTIME_COMPARISON_SITES, type RuntimeComparisonSite } from "@/experiments/scraper-v2/generic/runtimeComparisonSites";
import type { CrawlProfile, SourceExperiment } from "@/experiments/scraper-v2/generic/types";

loadLocalEnv();

const DEFAULT_TRACE_DIR = path.join(".local-audits", "traces", "phase-5-3", "adaptive-benchmark");

function argValue(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function listArg<T extends string>(name: string, fallback: T[]): T[] {
  const raw = argValue(name);
  if (!raw) return fallback;
  return raw.split(",").map((value) => value.trim()).filter(Boolean) as T[];
}

function originVariants(origin: string): string[] {
  const parsed = new URL(origin);
  const host = parsed.hostname;
  const variants = new Set([origin]);
  if (host.startsWith("www.")) variants.add(`${parsed.protocol}//${host.slice(4)}${parsed.port ? `:${parsed.port}` : ""}`);
  else variants.add(`${parsed.protocol}//www.${host}${parsed.port ? `:${parsed.port}` : ""}`);
  return [...variants];
}

function sourceForSite(site: RuntimeComparisonSite): SourceExperiment {
  const parsed = new URL(site.url);
  return {
    inputUrl: parsed.toString(),
    allowedOrigins: [...new Set([...originVariants(parsed.origin), ...(site.allowedOrigins ?? []).flatMap(originVariants)])],
    maxRequests: 260,
    maxPages: 80,
    maxBrowserActions: 10,
    maxPayloadBytes: 5_000_000,
    browserAllowed: true,
    expectedContentCategory: "public_event_directory",
    expectedMinimumEventCount: site.expectedMinimumEventCount,
  };
}

function queryForProfile(profile: CrawlProfile): string {
  switch (profile) {
    case "light":
      return "find 50 hackathons fast";
    case "standard":
      return "find 150 hackathons";
    case "deep":
      return "deep crawl 500+ hackathons";
    case "exhaustive":
      return "exhaustive all public hackathons";
  }
}

function pct(value: number, denominator: number): string {
  if (denominator <= 0) return "0%";
  return `${Math.round((value / denominator) * 100)}%`;
}

function markdownEscape(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

async function runOne(input: {
  profile: CrawlProfile;
  sites: RuntimeComparisonSite[];
  traceDir: string;
  label: string;
  query?: string;
}): Promise<{ label: string; profile: CrawlProfile; sites: RuntimeComparisonSite[]; result?: AdaptiveCrawlResult; error?: string }> {
  try {
    const result = await runAdaptiveCrawl({
      intent: { query: input.query ?? queryForProfile(input.profile) },
      sources: input.sites.map(sourceForSite),
      checkpointDir: path.join(input.traceDir, "checkpoints", input.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()),
    });
    return { label: input.label, profile: input.profile, sites: input.sites, result };
  } catch (error) {
    return {
      label: input.label,
      profile: input.profile,
      sites: input.sites,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function rowFor(run: Awaited<ReturnType<typeof runOne>>): string {
  if (!run.result) {
    return `| ${run.label} | ${run.profile} | ${run.sites.length} | error | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0 | ${markdownEscape(run.error ?? "unknown")} |`;
  }
  const result = run.result;
  const pages = result.sourceResults.reduce((total, source) => total + source.pagesRequested, 0);
  const actions = result.sourceResults.reduce((total, source) => total + source.actionsExecuted, 0);
  return [
    run.label,
    result.plan.profile,
    String(run.sites.length),
    result.stopReason,
    String(pages),
    String(actions),
    String(result.rawRecords),
    String(result.validEvents),
    String(result.inHorizonEvents),
    String(result.duplicatesRemoved),
    pct(result.validEvents, result.plan.targetValidEvents),
    (result.totalDurationMs / 1000).toFixed(1),
    markdownEscape(result.sourceResults.map((source) => `${new URL(source.sourceUrl).hostname}:${source.stopReason}`).join("; ")),
  ].join(" | ").replace(/^/, "| ").replace(/$/, " |");
}

function detailsFor(run: Awaited<ReturnType<typeof runOne>>): string[] {
  if (!run.result) return [`### ${run.label}`, "", `Error: ${run.error ?? "unknown"}`, ""];
  const result = run.result;
  return [
    `### ${run.label}`,
    "",
    `Profile: ${result.plan.profile}`,
    `Persistence: disabled`,
    `Plan: target ${result.plan.targetValidEvents}, max sources ${result.plan.maxSources}, max pages/source ${result.plan.maxPagesPerSource}, max browser actions/source ${result.plan.maxBrowserActionsPerSource}`,
    `Date horizon: ${result.plan.dateHorizonStart ?? "none"} to ${result.plan.dateHorizonEnd ?? "none"}`,
    `Stop: ${result.stopReason}`,
    `Progress: batches ${result.batches.length}, time to 10 ${result.timeToFirst10Ms ?? "n/a"} ms, time to 50 ${result.timeToFirst50Ms ?? "n/a"} ms, time to target ${result.timeToTargetMs ?? "n/a"} ms`,
    "",
    "| Source | Valid | In horizon | Open | Duplicates | Pages | Actions | Stop | Quality | Recall |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |",
    ...result.sourceResults.map((source) =>
      [
        new URL(source.sourceUrl).hostname,
        String(source.validEvents),
        String(source.inHorizonEvents),
        String(source.openRegistrationEvents),
        String(source.duplicatesRemoved),
        String(source.pagesRequested),
        String(source.actionsExecuted),
        markdownEscape(source.stopReason),
        source.result?.quality.classification ?? "error",
        `${Math.round((source.result?.quality.estimatedRecall ?? 0) * 100)}%`,
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"),
    ),
    "",
  ];
}

async function main(): Promise<void> {
  const traceDir = argValue("--trace-dir") ?? DEFAULT_TRACE_DIR;
  const profiles = listArg<CrawlProfile>("--profiles", ["light", "standard", "deep"]);
  const siteSlugs = listArg<string>("--sites", ["devpost", "mlh", "hackathon-radar", "dorahacks", "hackathons-space", "eventornado"]);
  const sites = RUNTIME_COMPARISON_SITES.filter((site) => siteSlugs.includes(site.slug));
  await mkdir(traceDir, { recursive: true });

  const runs: Awaited<ReturnType<typeof runOne>>[] = [];
  for (const profile of profiles) {
    console.log(`[phase-5-3] adaptive ${profile}`);
    runs.push(await runOne({ profile, sites, traceDir, label: `profile-${profile}` }));
  }

  if (argValue("--date-horizons") !== "false") {
    for (const query of ["hackathons next 2 weeks", "hackathons next 2 months", "hackathons next 6 months"]) {
      console.log(`[phase-5-3] adaptive ${query}`);
      const plan = buildCrawlPlan({ query });
      runs.push(await runOne({ profile: plan.profile, sites, traceDir, label: query, query }));
    }
  }

  const report = [
    "# Phase 5.3 Adaptive Crawl Benchmark",
    "",
    `Date: ${new Date().toISOString()}`,
    "Runtime: custom V2 only",
    "Persistence: disabled",
    "",
    "## Matrix",
    "",
    "| Run | Profile | Sources | Stop | Pages | Actions | Raw records | Valid events | In horizon | Duplicates | Target coverage | Duration s | Source stops |",
    "| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...runs.map(rowFor),
    "",
    "## Details",
    "",
    ...runs.flatMap(detailsFor),
  ].join("\n");

  await writeFile(path.join(traceDir, "adaptive-crawl-benchmark.md"), report, "utf8");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
