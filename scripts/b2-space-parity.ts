/**
 * Kernel-only hackathons.space parity probe (B4).
 * Experiment shadow comparison removed with scraper-v2.
 */
import { loadLocalEnv } from "@/cli/loadEnv";
import { collectCustomSourceViaKernel } from "@/crawl/adapters/custom/collect";
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
  const custom = source("https://www.hackathons.space/");
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
        titles: kernel.leads.slice(0, 8).map((lead) => lead.title),
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
