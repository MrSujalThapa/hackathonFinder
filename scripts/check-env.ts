/**
 * Environment validation for local/demo/production setup.
 * Prints variable names and integration status only — never secret values.
 * Does not contact external services.
 */
import { loadLocalEnv } from "../src/cli/loadEnv";
import {
  describeIntegrations,
  getServerEnv,
  hasOwnerAuthConfig,
  isDemoMode,
  resetServerEnvCacheForTests,
  validateProductionConfig,
} from "../src/config/env";

function printUsage(): void {
  console.log(`Usage: npm run env:check [-- --strict-production]

Validates environment variable names/formats and reports enabled integrations.
Never prints secret values. Never contacts external services.
`);
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return 0;
  }

  const strictProduction = argv.includes("--strict-production");

  console.log("=== Environment check ===\n");
  console.log(`cwd: ${process.cwd()}`);
  console.log("loading .env.local / .env via loadLocalEnv()");
  loadLocalEnv();
  resetServerEnvCacheForTests();

  let env: ReturnType<typeof getServerEnv>;
  try {
    env = getServerEnv();
  } catch (error) {
    console.log("\nRESULT: FAIL");
    console.log("category: invalid_env");
    console.log(error instanceof Error ? error.message : "Environment parsing failed");
    return 1;
  }

  console.log("\n--- Runtime ---");
  console.log(`NODE_ENV: ${env.NODE_ENV}`);
  console.log(`VERCEL_ENV: ${env.VERCEL_ENV ?? "(unset)"}`);
  console.log(`APP_URL: ${env.APP_URL ? "set" : "(unset)"}`);
  console.log(`DEMO_MODE: ${isDemoMode(env) ? "enabled" : "disabled"}`);
  console.log(
    `Owner auth: ${hasOwnerAuthConfig(env) ? "configured" : "missing"}`,
  );
  console.log(
    `APP_SESSION_SECRET length ok (>=32): ${
      (env.APP_SESSION_SECRET?.length ?? 0) >= 32 ? "yes" : "no"
    }`,
  );

  console.log("\n--- Integrations ---");
  for (const item of describeIntegrations(env)) {
    console.log(`${item.name}: ${item.status} — ${item.detail}`);
  }

  console.log("\n--- Notes ---");
  console.log(
    "Google private_key newlines: embed JSON with \\n escapes in GOOGLE_SERVICE_ACCOUNT_JSON; they are normalized at parse time.",
  );
  console.log(
    "Server-only secrets must never use the NEXT_PUBLIC_ prefix.",
  );
  console.log(
    "PERSISTENCE_ROLLBACK_V1 is emergency-only and rejected in production validation.",
  );

  const issues: string[] = [];

  if (!hasOwnerAuthConfig(env) && (env.NODE_ENV === "production" || isDemoMode(env))) {
    issues.push("Owner auth required for production/demo: APP_PASSWORD and APP_SESSION_SECRET.");
  }

  if (strictProduction || env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    issues.push(...validateProductionConfig(env));
  }

  if (issues.length > 0) {
    console.log("\nRESULT: FAIL");
    for (const issue of [...new Set(issues)]) {
      console.log(`- ${issue}`);
    }
    return 1;
  }

  console.log("\nRESULT: OK");
  if (!hasOwnerAuthConfig(env)) {
    console.log(
      "hint: set APP_PASSWORD and APP_SESSION_SECRET before running the web app.",
    );
  }
  return 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
