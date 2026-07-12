import { randomUUID } from "node:crypto";
import { executeClaimedJob } from "./execute";
import { getDiscoveryJobStore } from "@/jobs/store";
import { readDiscoveryRuntimeConfig } from "@/discovery/config";
import type { DiscoveryJob } from "@/jobs/types";

const DEFAULT_LEASE_MS = 60_000;
const POLL_MS = 2_000;

export async function claimAndExecuteOnce(
  workerId = `worker-${randomUUID().slice(0, 8)}`,
): Promise<DiscoveryJob | null> {
  const store = getDiscoveryJobStore();
  const claimed = await store.claimNextJob(workerId, DEFAULT_LEASE_MS);
  if (!claimed) return null;
  return executeClaimedJob(claimed.job.id, workerId, claimed.claimToken);
}

export async function startWorkerLoop(): Promise<void> {
  const config = readDiscoveryRuntimeConfig();
  if (config.executionMode !== "worker") {
    console.warn(
      "[worker] DISCOVERY_EXECUTION_MODE is not worker; continuing anyway for local validation.",
    );
  }

  const workerId = process.env.WORKER_ID?.trim() || `worker-${randomUUID().slice(0, 8)}`;
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    console.log(`[worker] ${signal} received — graceful shutdown`);
    shuttingDown = true;
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.log(`[worker] started id=${workerId}`);

  // Minimal health heartbeat for container orchestration.
  const healthTimer = setInterval(() => {
    console.log(`[worker] health ok id=${workerId} ts=${new Date().toISOString()}`);
  }, 30_000);

  while (!shuttingDown) {
    try {
      const result = await claimAndExecuteOnce(workerId);
      if (!result) {
        await sleep(POLL_MS);
      }
    } catch (error) {
      console.error(
        "[worker] loop error",
        error instanceof Error ? error.message : error,
      );
      await sleep(POLL_MS);
    }
  }

  clearInterval(healthTimer);
  console.log("[worker] stopped");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
