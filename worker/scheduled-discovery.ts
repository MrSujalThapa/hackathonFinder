/** One scheduled, deterministic discovery pass. It exits after persisting its results. */
import { loadLocalEnv } from "@/cli/loadEnv";

loadLocalEnv();

async function main(): Promise<void> {
  const { runAgent } = await import("@/agent/runAgent");
  await runAgent("find upcoming hackathons in Canada or remote", false, {
    sources: ["luma", "web"],
    deterministic: true,
    reviewPolicy: "balanced",
    maxResults: 40,
  });
  console.log("[scheduled-discovery] completed");
}

void main().catch((error) => {
  console.error(`[scheduled-discovery] fatal ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
