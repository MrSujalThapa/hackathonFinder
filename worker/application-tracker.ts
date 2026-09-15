import { loadLocalEnv } from "@/cli/loadEnv";

loadLocalEnv();

async function main(): Promise<void> {
  const { runApplicationTracker } = await import(
    "@/server/applications/tracker"
  );

  const result = await runApplicationTracker();

  console.log(
    `[application-tracker] notifications=${result.notifications}`,
  );
}

void main().catch((error) => {
  console.error(
    "[application-tracker] fatal",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});