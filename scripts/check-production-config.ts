/**
 * Production configuration validation. This is intentionally read-only and
 * prints only variable names / configuration state, never secret values.
 */
import { loadLocalEnv } from "../src/cli/loadEnv";
import { getServerEnv, validateProductionConfig } from "../src/config/env";

async function main(): Promise<number> {
  console.log("=== Production configuration check ===\n");
  console.log(`cwd: ${process.cwd()}`);
  console.log("loading env via loadLocalEnv() from repository root");
  loadLocalEnv();

  let env: ReturnType<typeof getServerEnv>;
  try {
    env = getServerEnv();
  } catch (error) {
    console.log("\nRESULT: FAIL");
    console.log("category: invalid_env");
    console.log(error instanceof Error ? error.message : "Environment parsing failed");
    return 1;
  }

  const issues = validateProductionConfig(env);
  console.log("\n--- Environment ---");
  console.log(`NODE_ENV: ${env.NODE_ENV}`);
  console.log(`VERCEL_ENV: ${env.VERCEL_ENV ?? "(unset)"}`);
  console.log(`Supabase: ${env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? "configured" : "missing"}`);
  console.log(`Google Sheets: ${env.GOOGLE_SHEET_ID && env.GOOGLE_SERVICE_ACCOUNT_JSON ? "configured" : "missing"}`);
  console.log(
    `Owner auth: ${
      (env.APP_OWNER_PASSWORD_HASH_B64 || env.APP_OWNER_PASSWORD_HASH) &&
      env.APP_SESSION_SECRET
        ? "configured"
        : "missing"
    }`,
  );
  console.log(`Mock candidates: ${env.USE_MOCK_CANDIDATES ? "enabled" : "disabled"}`);
  console.log(`X: ${env.X_BEARER_TOKEN ? "configured" : "not configured"} (not required)`);

  if (issues.length > 0) {
    console.log("\nRESULT: FAIL");
    for (const issue of issues) {
      console.log(`- ${issue}`);
    }
    return 1;
  }

  console.log("\nRESULT: OK");
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
