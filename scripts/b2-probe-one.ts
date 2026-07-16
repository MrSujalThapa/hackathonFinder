import { loadLocalEnv } from "@/cli/loadEnv";
import { collectCustomSourceViaKernel } from "@/crawl/adapters/custom/collect";
import type { CustomSource } from "@/server/customSources/types";

loadLocalEnv();

async function main(): Promise<void> {
  const label = process.argv[2] ?? "hackathons.space";
  const defaults: Record<string, string> = {
    "hackathons.space": "https://www.hackathons.space/",
    eventornado: "https://eventornado.com/events",
    taikai: "https://taikai.network/hackathons",
  };
  const url = process.argv[3] ?? defaults[label] ?? "https://www.hackathons.space/";

  const source: CustomSource = {
    id: `probe-${label}`,
    name: label,
    slug: label.replace(/[^a-z0-9]+/gi, "-").toLowerCase(),
    baseUrl: new URL(url).origin,
    listingUrl: url,
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

  const result = await collectCustomSourceViaKernel(source, {
    persistHealth: false,
    logger: (message) => console.log(message),
  });

  console.log(
    JSON.stringify(
      {
        leads: result.leads.length,
        status: result.status,
        stop: result.diagnostics.stopReason,
        state: result.diagnostics.safeMessage,
        pages: result.diagnostics.pagesTraversed,
        metrics: result.metrics,
        warnings: result.warnings,
        titles: result.leads.slice(0, 12).map((lead) => lead.title),
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
