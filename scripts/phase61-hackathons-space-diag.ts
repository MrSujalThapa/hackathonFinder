import { loadLocalEnv } from "@/cli/loadEnv";
import { customSourceToExperiment } from "@/discovery/genericScraperV2Mode";
import { inferDiscoveryBudget } from "@/experiments/scraper-v2/generic/budget";
import {
  formatGenericStructuredExtractionResult,
  runGenericStructuredExtraction,
} from "@/experiments/scraper-v2/generic/structuredExtraction";
import type { SourceExperiment } from "@/experiments/scraper-v2/generic/types";
import type { CustomSource } from "@/server/customSources/types";

loadLocalEnv();

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

function experimentHarnessConfig(): SourceExperiment {
  const inputUrl = "https://www.hackathons.space/";
  const parsed = new URL(inputUrl);
  return {
    inputUrl,
    allowedOrigins: originVariants(parsed.origin),
    maxRequests: 40,
    maxPages: 3,
    maxBrowserActions: 3,
    maxPayloadBytes: 5_000_000,
    browserAllowed: true,
    expectedContentCategory: "public_event_directory",
    expectedMinimumEventCount: 20,
  };
}

function productionPathConfig(): SourceExperiment {
  const source: CustomSource = {
    id: "diag",
    name: "hackathons.space",
    slug: "hackathons-space",
    baseUrl: "https://www.hackathons.space",
    listingUrl: "https://www.hackathons.space/",
    mode: "auto",
    enabled: true,
    locationScope: "",
    topicScope: [],
    maxItems: 40,
    status: "unknown",
    lastCheckedAt: null,
    lastErrorSafe: null,
    selectors: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return customSourceToExperiment(source);
}

async function runLabeled(label: string, experiment: SourceExperiment, withBudget: boolean) {
  console.log(`\n======== ${label} ========`);
  console.log(JSON.stringify(experiment, null, 2));
  const result = await runGenericStructuredExtraction(experiment, {
    ...(withBudget
      ? {
          budget: inferDiscoveryBudget({
            query: "standard public hackathon directory coverage",
          }),
        }
      : {}),
  });
  console.log(formatGenericStructuredExtractionResult(result).join("\n"));
  console.log(
    JSON.stringify(
      {
        finalUrl: result.finalUrl,
        classification: result.quality.classification,
        valid: result.quality.validEventLeads,
        normalized: result.quality.normalizedLeads,
        discovered: result.quality.discoveredRecords,
        pages: result.pagination.pageCount,
        paginationStop: result.pagination.stopReason,
        strategy: result.strategySelected,
        acquisitionMode: result.acquisitionMode,
        actionsExecuted: result.acquisition.actionsExecuted,
        actionsDiscovered: result.acquisition.actionsDiscovered,
        pagesRequested: result.acquisition.pagesRequested,
        blockedReason: result.acquisition.blockedReason,
        skippedLayers: result.acquisition.skippedLayers,
        ai: result.aiAssistance,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const harness = experimentHarnessConfig();
  const production = productionPathConfig();
  console.log("DIFF keys");
  for (const key of Object.keys(harness) as Array<keyof SourceExperiment>) {
    const left = JSON.stringify(harness[key]);
    const right = JSON.stringify(production[key]);
    if (left !== right) console.log(`  ${key}: harness=${left} production=${right}`);
  }
  await runLabeled("harness+budget", harness, true);
  await runLabeled("production-path-no-budget", production, false);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
