import { executeDiscoveryJob } from "@/jobs/executor";
import { getDiscoveryJobStore } from "@/jobs/store";
import type { DiscoveryJob } from "@/jobs/types";

const HEARTBEAT_MS = 20_000;
const LEASE_MS = 60_000;

export async function executeClaimedJob(
  jobId: string,
  workerId: string,
  claimToken: string,
): Promise<DiscoveryJob> {
  const store = getDiscoveryJobStore();
  const heartbeat = setInterval(() => {
    void store.heartbeatClaim(jobId, claimToken, LEASE_MS);
  }, HEARTBEAT_MS);

  try {
    return await executeDiscoveryJob({ jobId, workerId });
  } finally {
    clearInterval(heartbeat);
  }
}
