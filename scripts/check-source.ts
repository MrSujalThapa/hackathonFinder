/**
 * Bounded live diagnostic for a single healthable source.
 * Usage: npm run check:source -- mlh
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "../src/cli/loadEnv";
import {
  HEALTHABLE_SOURCES,
  assertHealthableSource,
  checkSourceHealth,
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
}

function isPassing(health: SourceHealth): boolean {
  return (
    health.status === "healthy" ||
    health.status === "degraded" ||
    health.status === "disabled"
  );
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  console.log("=== Single-source health diagnostic ===\n");
  loadLocalEnv();

  const name = argv[0]?.trim().toLowerCase();
  if (!name) {
    console.log("Usage: npm run check:source -- <name>");
    console.log(`Allowed: ${HEALTHABLE_SOURCES.join(", ")}`);
    return 1;
  }

  let source;
  try {
    source = assertHealthableSource(name);
  } catch (error) {
    console.log(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const health = await checkSourceHealth(source, { live: true, persist: true });
  printHealth(health);

  if (!isPassing(health)) {
    console.log("\nRESULT: FAIL");
    return 1;
  }
  console.log("\nRESULT: OK");
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

export { main as checkSource };
