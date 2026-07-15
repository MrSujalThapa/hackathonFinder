import { loadLocalEnv } from "@/cli/loadEnv";
import {
  collectCustomSourceWithV2Routing,
  isBlockedCustomSourceUrl,
  readGenericScraperV2Mode,
} from "@/discovery/genericScraperV2Mode";
import type { CustomSource } from "@/server/customSources/types";

const loadEnv = process.argv.includes("--load-env");
if (loadEnv) loadLocalEnv();

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
  mode: "off" | "shadow" | "live",
): Promise<void> {
  console.log(`\n=== ${label} mode=${mode} loadEnv=${loadEnv} ===`);
  console.log(`blocked_host=${isBlockedCustomSourceUrl(listingUrl)}`);
  console.log(
    `openai=${process.env.OPENAI_API_KEY ? "set" : "missing"} anthropic=${process.env.ANTHROPIC_API_KEY ? "set" : "missing"}`,
  );
  const result = await collectCustomSourceWithV2Routing(source(label, listingUrl), {
    mode,
    timeoutMs: 90_000,
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
        provenance: result.leads[0]?.metadata?.provenance ?? null,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  console.log(`env_mode=${readGenericScraperV2Mode()}`);
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);
  const modeArg = process.argv.find((arg) => arg.startsWith("--mode="))?.slice("--mode=".length) as
    | "off"
    | "shadow"
    | "live"
    | undefined;
  const mode = modeArg ?? "live";

  if (!only || only === "dorahacks") {
    await probe("dorahacks", "https://dorahacks.io/hackathon", mode === "off" ? "shadow" : mode);
  }
  if (!only || only === "hackathons-space") {
    await probe("hackathons-space", "https://www.hackathons.space/", mode);
  }
  if (!only || only === "eventornado") {
    await probe("eventornado", "https://eventornado.com/events", mode);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
