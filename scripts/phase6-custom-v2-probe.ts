import { loadLocalEnv } from "@/cli/loadEnv";
import {
  collectCustomSourceWithV2Routing,
  isBlockedCustomSourceUrl,
  readGenericScraperV2Mode,
} from "@/discovery/genericScraperV2Mode";
import type { CustomSource } from "@/server/customSources/types";

loadLocalEnv();

function source(slug: string, listingUrl: string): CustomSource {
  return {
    id: `probe-${slug}`,
    name: slug,
    slug,
    baseUrl: listingUrl,
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

async function probe(
  label: string,
  listingUrl: string,
  mode: "shadow" | "live",
): Promise<void> {
  console.log(`\n=== ${label} mode=${mode} ===`);
  console.log(`blocked_host=${isBlockedCustomSourceUrl(listingUrl)}`);
  const result = await collectCustomSourceWithV2Routing(source(label, listingUrl), {
    mode,
    timeoutMs: 60_000,
    persistHealth: false,
    logger: (message) => console.log(message),
  });
  console.log(
    JSON.stringify(
      {
        status: result.status,
        leads: result.leads.length,
        warnings: result.warnings,
        metrics: result.metrics ?? null,
        stopReason: result.diagnostics.stopReason,
        safeMessage: result.diagnostics.safeMessage,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  console.log(`env_mode=${readGenericScraperV2Mode()}`);
  await probe("dorahacks", "https://dorahacks.io/hackathon", "shadow");
  await probe("hackathons-space", "https://www.hackathons.space/", "shadow");
  await probe("eventornado", "https://eventornado.com/events", "shadow");
  await probe("hackathons-space", "https://www.hackathons.space/", "live");
  await probe("eventornado", "https://eventornado.com/events", "live");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
