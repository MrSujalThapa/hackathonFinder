/**
 * Bounded live diagnostics for all healthable sources (excludes X).
 * Never prints secrets, cookies, or browser profile paths.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "../src/cli/loadEnv";
import {
  HEALTHABLE_SOURCES,
  checkAllSourcesHealth,
  type SourceHealth,
} from "../src/lib/sources";

function printHealth(health: SourceHealth): void {
  console.log(`\n=== ${health.displayName} (${health.source}) ===`);
  console.log(`status: ${health.status}`);
  console.log(`enabled: ${health.enabled}`);
  if (health.authenticated != null) {
    console.log(`authenticated: ${health.authenticated}`);
  }
  if (health.connectionStatus && health.connectionStatus !== "n/a") {
    console.log(`connection: ${health.connectionStatus}`);
  }
  if (health.mode) console.log(`mode: ${health.mode}`);
  console.log(`checked: ${health.lastCheckedAt}`);
  if (health.lastSuccessfulAt) console.log(`lastSuccess: ${health.lastSuccessfulAt}`);
  if (health.durationMs != null) console.log(`durationMs: ${health.durationMs}`);
  if (health.leadsFound != null) console.log(`leadsFound: ${health.leadsFound}`);
  if (health.accepted != null) console.log(`accepted: ${health.accepted}`);
  if (health.failureCategory) console.log(`failureCategory: ${health.failureCategory}`);
  if (health.safeMessage) console.log(`message: ${health.safeMessage}`);
  console.log(
    `capabilities: public=${health.capabilities.publicDiscovery} auth=${health.capabilities.authenticatedDiscovery} browser=${health.capabilities.browserRequired}`,
  );
}

function isPassing(health: SourceHealth): boolean {
  return (
    health.status === "healthy" ||
    health.status === "degraded" ||
    health.status === "disabled"
  );
}

async function main(): Promise<number> {
  console.log("=== Source health diagnostics ===\n");
  console.log(`cwd: ${process.cwd()}`);
  console.log("loading env via loadLocalEnv()");
  loadLocalEnv();
  console.log(`sources: ${HEALTHABLE_SOURCES.join(", ")} (X excluded)`);

  const results = await checkAllSourcesHealth({ live: true, persist: true });
  for (const health of results) {
    printHealth(health);
  }

  const failures = results.filter((item) => !isPassing(item));
  console.log("\n=== Summary ===");
  console.log(
    results
      .map((item) => `${item.source}:${item.status}`)
      .join(" | "),
  );

  if (failures.length > 0) {
    console.log(`\nRESULT: FAIL (${failures.length} source(s) need attention)`);
    return 1;
  }

  console.log("\nRESULT: OK (healthy, degraded, or intentionally disabled)");
  return 0;
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error("Unexpected source diagnostic failure:", error);
      process.exit(1);
    });
}

export { main as checkSources };
