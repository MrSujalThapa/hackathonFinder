import { loadLocalEnv } from "@/cli/loadEnv";
import { collectCustomSourceViaKernel } from "@/crawl/adapters/custom/collect";
import type { CustomSource } from "@/server/customSources/types";

loadLocalEnv();
delete process.env.LLM_PROVIDER;
delete process.env.LLM_API_KEY;

async function main(): Promise<void> {
  const source: CustomSource = {
    id: "no-llm",
    name: "hackathons.space",
    slug: "space-no-llm",
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
  const result = await collectCustomSourceViaKernel(source, {
    persistHealth: false,
    logger: console.log,
  });
  console.log(
    JSON.stringify(
      {
        leads: result.leads.length,
        status: result.status,
        state: result.diagnostics.safeMessage,
        stop: result.diagnostics.stopReason,
        metrics: result.metrics,
        warnings: result.warnings,
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
