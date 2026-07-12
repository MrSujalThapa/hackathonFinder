import { executeDiscoveryJob } from "@/jobs/executor";
import { getDiscoveryJobStore } from "@/jobs/store";
import {
  assertLocalExecutionAllowed,
  readDiscoveryRuntimeConfig,
} from "@/discovery/config";
import type { CreateDiscoveryJobInput, DiscoveryJob } from "@/jobs/types";
import { assertApiSourcesAllowlisted } from "@/discovery/selectSources";
import type { SourceName } from "@/core/discovery/types";

/**
 * Enqueue a discovery job and optionally start local in-process execution.
 */
export async function enqueueDiscoveryJob(
  input: CreateDiscoveryJobInput,
): Promise<{ job: DiscoveryJob; execution: "local" | "worker" }> {
  const config = readDiscoveryRuntimeConfig();
  const store = getDiscoveryJobStore();

  if (input.requestedSources?.length) {
    assertApiSourcesAllowlisted(input.requestedSources);
  }

  const active = await store.countActiveJobs();
  if (active >= config.maxActiveJobs) {
    throw new Error(
      `Too many active discovery jobs (max ${config.maxActiveJobs}). Wait for an active run to finish or cancel it.`,
    );
  }

  const job = await store.createJob(input);
  await store.appendEvent(job.id, {
    type: "run_queued",
    level: "info",
    message: "Discovery job queued",
    metadata: {
      executionMode: config.executionMode,
      requestedSources: input.requestedSources ?? [],
    },
  });

  if (config.executionMode === "local") {
    assertLocalExecutionAllowed(config);
    // Fire-and-forget local execution; callers stream events via SSE.
    void executeDiscoveryJob({ jobId: job.id, workerId: "local-web" }).catch(
      (error) => {
        console.error(
          "[discovery-jobs] local execution failed",
          error instanceof Error ? error.message : error,
        );
      },
    );
    return { job, execution: "local" };
  }

  return { job, execution: "worker" };
}

export function parseRequestedSources(
  raw?: string[],
): SourceName[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  return raw.map((value) => value.trim().toLowerCase()) as SourceName[];
}
