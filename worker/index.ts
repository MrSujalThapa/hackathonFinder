/**
 * Discovery worker entrypoint (skeleton).
 * Claims queued jobs and runs the shared discovery service.
 * Do not deploy in this phase.
 */

import { claimAndExecuteOnce, startWorkerLoop } from "./claim";

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  if (once) {
    const result = await claimAndExecuteOnce();
    if (!result) {
      console.log("[worker] no queued jobs");
      return;
    }
    console.log(`[worker] finished job ${result.id} status=${result.status}`);
    return;
  }

  await startWorkerLoop();
}

void main().catch((error) => {
  console.error("[worker] fatal", error instanceof Error ? error.message : error);
  process.exit(1);
});
