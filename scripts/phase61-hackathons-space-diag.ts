/**
 * hackathons.space diagnostic (B4 kernel-only).
 * Former experiment structuredExtraction path removed with scraper-v2.
 */
import { loadLocalEnv } from "@/cli/loadEnv";
import { collectCustomSourceViaKernel } from "@/crawl/adapters/custom/collect";
import type { CustomSource } from "@/server/customSources/types";

loadLocalEnv();

function source(): CustomSource {
  const listingUrl = "https://www.hackathons.space/";
  return {
    id: "diag-space",
    name: "hackathons.space",
    slug: "hackathons-space",
    baseUrl: "https://www.hackathons.space",
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
  const result = await collectCustomSourceViaKernel(source(), {
    persistHealth: false,
    logger: console.log,
  });
  console.log(
    JSON.stringify(
      {
        leads: result.leads.length,
        status: result.status,
        stop: result.diagnostics.stopReason,
        state: result.diagnostics.safeMessage,
        warnings: result.warnings.slice(0, 20),
        titles: result.leads.slice(0, 10).map((lead) => lead.title),
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
