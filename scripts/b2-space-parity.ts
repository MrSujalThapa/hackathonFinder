import { loadLocalEnv } from "@/cli/loadEnv";
import { collectCustomSourceViaKernel } from "@/crawl/adapters/custom/collect";
import { customSourceToExperiment } from "@/discovery/genericScraperV2Mode";
import type { CustomSource } from "@/server/customSources/types";

loadLocalEnv();

function source(listingUrl: string): CustomSource {
  return {
    id: "parity",
    name: "space",
    slug: "space-parity",
    baseUrl: new URL(listingUrl).origin,
    listingUrl,
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
}

async function main(): Promise<void> {
  const listingUrl = "https://www.hackathons.space/";
  const custom = source(listingUrl);

  console.log("=== kernel ===");
  const kernel = await collectCustomSourceViaKernel(custom, {
    persistHealth: false,
    logger: console.log,
  });
  console.log(
    JSON.stringify(
      {
        leads: kernel.leads.length,
        stop: kernel.diagnostics.stopReason,
        state: kernel.diagnostics.safeMessage,
        pages: kernel.diagnostics.pagesTraversed,
        metrics: kernel.metrics,
      },
      null,
      2,
    ),
  );

  console.log("=== experiment structured (shadow compare) ===");
  const { inferDiscoveryBudget } = await import("@/experiments/scraper-v2/generic/budget");
  const { runGenericStructuredExtraction } = await import(
    "@/experiments/scraper-v2/generic/structuredExtraction"
  );
  const extraction = await runGenericStructuredExtraction(customSourceToExperiment(custom), {
    budget: inferDiscoveryBudget({ query: "standard public hackathon directory coverage" }),
  });
  console.log(
    JSON.stringify(
      {
        valid: extraction.quality.validEventLeads,
        normalized: extraction.quality.normalizedLeads,
        class: extraction.quality.classification,
        pages: extraction.pagination.pageCount,
        actions: extraction.acquisition.actionsExecuted,
        stop: extraction.pagination.stopReason,
        ai: extraction.aiAssistance,
        titles: extraction.leads.slice(0, 8).map((lead) => lead.title),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
