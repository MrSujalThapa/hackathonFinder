import { executeDiscoveryJob } from "@/jobs/executor";
import { getDiscoveryJobStore } from "@/jobs/store";
import {
  assertLocalExecutionAllowed,
  readDiscoveryRuntimeConfig,
} from "@/discovery/config";
import {
  assertJobQueueAdmission,
  getDiscoveryJobConcurrencyGate,
  isDiscoveryJobCancelledWhileQueuedError,
  isDiscoveryJobQueueFullError,
  RUNNING_JOB_STATUSES,
} from "@/discovery/concurrency";
import type { CreateDiscoveryJobInput, DiscoveryJob } from "@/jobs/types";
import { assertApiSourcesAllowlisted } from "@/discovery/selectSources";
import type { SourceName } from "@/core/discovery/types";

async function countJobLoad(store: ReturnType<typeof getDiscoveryJobStore>): Promise<{
  running: number;
  waiting: number;
}> {
  const jobs = await store.listJobs({ limit: 200 });
  let running = 0;
  let waiting = 0;
  for (const job of jobs) {
    if (job.status === "queued") waiting += 1;
    else if (
      (RUNNING_JOB_STATUSES as readonly string[]).includes(job.status)
    ) {
      running += 1;
    }
  }
  return { running, waiting };
}

/**
 * Enqueue a discovery job and optionally start local in-process execution.
 * Excess jobs wait in the concurrency gate up to DISCOVERY_MAX_QUEUED_JOBS.
 */
export async function enqueueDiscoveryJob(
  input: CreateDiscoveryJobInput,
): Promise<{ job: DiscoveryJob; execution: "local" | "worker" }> {
  const config = readDiscoveryRuntimeConfig();
  const store = getDiscoveryJobStore();

  if (input.requestedSources?.length) {
    assertApiSourcesAllowlisted(input.requestedSources);
  }

  const load = await countJobLoad(store);
  assertJobQueueAdmission({
    waiting: load.waiting,
    maxQueuedJobs: config.maxQueuedJobs,
  });

  const job = await store.createJob(input);
  const queuePosition = load.running >= config.maxActiveJobs ? load.waiting + 1 : 0;

  await store.appendEvent(job.id, {
    type: "run_queued",
    level: "info",
    message:
      queuePosition > 0
        ? `Discovery job queued — position ${queuePosition}`
        : "Discovery job queued",
    metadata: {
      executionMode: config.executionMode,
      requestedSources: input.requestedSources ?? [],
      queuePosition,
      maxActiveJobs: config.maxActiveJobs,
      maxQueuedJobs: config.maxQueuedJobs,
      runningJobs: load.running,
      waitingJobs: load.waiting + (queuePosition > 0 ? 1 : 0),
    },
  });

  if (config.executionMode === "local") {
    assertLocalExecutionAllowed(config);
    const gate = getDiscoveryJobConcurrencyGate();

    void gate
      .run(
        {
          jobId: job.id,
          onPosition: async (position) => {
            if (position <= 0) return;
            await store.appendEvent(job.id, {
              type: "run_queued",
              level: "info",
              message: `Waiting for execution slot — queue position ${position}`,
              metadata: {
                queuePosition: position,
                maxActiveJobs: config.maxActiveJobs,
                maxQueuedJobs: config.maxQueuedJobs,
              },
            });
          },
          isCancelled: async () => {
            const latest = await store.getJob(job.id);
            return Boolean(
              latest?.cancelRequested || latest?.status === "cancelled",
            );
          },
        },
        async () => {
          await executeDiscoveryJob({ jobId: job.id, workerId: "local-web" });
        },
      )
      .catch(async (error) => {
        if (isDiscoveryJobCancelledWhileQueuedError(error)) {
          const latest = await store.getJob(job.id);
          if (latest && latest.status === "queued") {
            await store.transitionToTerminal(job.id, {
              status: "cancelled",
              progress: 100,
              currentStage: "cancelled",
              cancelledAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
              safeErrorMessage: "Cancelled while queued",
            }, {
              type: "run_cancelled",
              level: "warning",
              message: "Cancelled while queued",
            });
          }
          return;
        }
        if (isDiscoveryJobQueueFullError(error)) {
          await store.transitionToTerminal(job.id, {
            status: "failed",
            progress: 100,
            currentStage: "failed",
            completedAt: new Date().toISOString(),
            failureCategory: "queue_full",
            safeErrorMessage:
              error instanceof Error ? error.message.slice(0, 500) : "Job queue full",
          }, {
            type: "run_failed",
            level: "error",
            message: error instanceof Error ? error.message : "Job queue full",
          });
          return;
        }
        console.error(
          "[discovery-jobs] local execution failed",
          error instanceof Error ? error.message : error,
        );
      });

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

export { isDiscoveryJobQueueFullError };
