/**
 * DEV-ONLY in-memory discovery job/event store.
 *
 * Labeled clearly: never use as a silent production fallback.
 * Production must fail if database job persistence is required but unavailable.
 */

import { randomUUID } from "node:crypto";
import {
  sanitizeEventMetadata,
  type DiscoveryEvent,
} from "@/discovery/events";
import {
  ACTIVE_JOB_STATUSES,
  type CreateDiscoveryJobInput,
  type DiscoveryJob,
  type DiscoveryJobRepository,
  type ListJobsParams,
} from "@/jobs/types";

type MemoryState = {
  jobs: Map<string, DiscoveryJob>;
  events: Map<string, DiscoveryEvent[]>;
  sequences: Map<string, number>;
};

const MEMORY_STATE_KEY = "__hackathonFinderDiscoveryJobMemoryState";
const MEMORY_NOTICE_KEY = "__hackathonFinderDiscoveryJobMemoryNoticeShown";

const globalState: MemoryState =
  ((globalThis as unknown as Record<string, MemoryState | undefined>)[
    MEMORY_STATE_KEY
  ] ??= {
    jobs: new Map(),
    events: new Map(),
    sequences: new Map(),
  });

export function resetMemoryDiscoveryJobStoreForTests(): void {
  globalState.jobs.clear();
  globalState.events.clear();
  globalState.sequences.clear();
}

function nowIso(): string {
  return new Date().toISOString();
}

function requireJob(id: string): DiscoveryJob {
  const job = globalState.jobs.get(id);
  if (!job) throw new Error(`Discovery job not found: ${id}`);
  return job;
}

export function createMemoryDiscoveryJobStore(): DiscoveryJobRepository {
  const globals = globalThis as unknown as Record<string, boolean | undefined>;
  if (!globals[MEMORY_NOTICE_KEY]) {
    globals[MEMORY_NOTICE_KEY] = true;
    console.info(
      "[discovery-jobs] Using DEV-ONLY in-memory job store. Not for production persistence.",
    );
  }

  return {
    async createJob(input: CreateDiscoveryJobInput): Promise<DiscoveryJob> {
      const id = randomUUID();
      const job: DiscoveryJob = {
        id,
        command: input.command,
        status: "queued",
        requestedSources: input.requestedSources ?? [],
        effectiveSources: [],
        mode: input.mode ?? "auto",
        dryRun: input.dryRun === true,
        allSources: input.allSources === true,
        maxAgentCalls: input.maxAgentCalls ?? null,
        progress: 0,
        currentStage: "queued",
        createdAt: nowIso(),
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        failureCategory: null,
        safeErrorMessage: null,
        agentRunId: null,
        createdCount: 0,
        updatedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        needsReviewCount: 0,
        rawLeadsCount: 0,
        durationMs: null,
        claimToken: null,
        claimedAt: null,
        claimExpiresAt: null,
        workerId: null,
        cancelRequested: false,
        summary: null,
      };
      globalState.jobs.set(id, job);
      globalState.events.set(id, []);
      globalState.sequences.set(id, 0);
      return { ...job };
    },

    async getJob(id: string): Promise<DiscoveryJob | null> {
      const job = globalState.jobs.get(id);
      return job ? { ...job } : null;
    },

    async listJobs(params: ListJobsParams = {}): Promise<DiscoveryJob[]> {
      const limit = params.limit ?? 20;
      let jobs = [...globalState.jobs.values()];
      if (params.status) {
        jobs = jobs.filter((job) => job.status === params.status);
      }
      jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return jobs.slice(0, limit).map((job) => ({ ...job }));
    },

    async countActiveJobs(): Promise<number> {
      return [...globalState.jobs.values()].filter((job) =>
        ACTIVE_JOB_STATUSES.includes(job.status),
      ).length;
    },

    async requestCancel(id: string): Promise<DiscoveryJob | null> {
      const job = globalState.jobs.get(id);
      if (!job) return null;
      if (["completed", "failed", "cancelled"].includes(job.status)) {
        return { ...job };
      }
      job.cancelRequested = true;
      if (job.status === "queued") {
        job.status = "cancelled";
        job.cancelledAt = nowIso();
        job.completedAt = job.cancelledAt;
        job.currentStage = "cancelled";
      }
      globalState.jobs.set(id, job);
      return { ...job };
    },

    async markStarted(id, patch = {}): Promise<DiscoveryJob> {
      const job = requireJob(id);
      job.status = patch.status ?? "planning";
      job.startedAt = job.startedAt ?? nowIso();
      job.currentStage = patch.currentStage ?? job.status;
      if (patch.effectiveSources) job.effectiveSources = patch.effectiveSources;
      if (patch.agentRunId) job.agentRunId = patch.agentRunId;
      globalState.jobs.set(id, job);
      return { ...job };
    },

    async updateJob(id, patch): Promise<DiscoveryJob> {
      const job = requireJob(id);
      Object.assign(job, patch);
      globalState.jobs.set(id, job);
      return { ...job };
    },

    async appendEvent(jobId, partial): Promise<DiscoveryEvent> {
      requireJob(jobId);
      const next = (globalState.sequences.get(jobId) ?? 0) + 1;
      globalState.sequences.set(jobId, next);
      const event: DiscoveryEvent = {
        id: partial.id ?? randomUUID(),
        runId: jobId,
        sequence: partial.sequence ?? next,
        timestamp: partial.timestamp ?? nowIso(),
        type: partial.type,
        level: partial.level,
        source: partial.source,
        message: partial.message,
        metadata: sanitizeEventMetadata(partial.metadata),
      };
      const list = globalState.events.get(jobId) ?? [];
      list.push(event);
      globalState.events.set(jobId, list);
      return event;
    },

    async listEvents(jobId, options = {}): Promise<DiscoveryEvent[]> {
      const list = globalState.events.get(jobId) ?? [];
      const after = options.afterSequence ?? 0;
      const limit = options.limit ?? 500;
      return list.filter((event) => event.sequence > after).slice(0, limit);
    },

    async claimNextJob(workerId, leaseMs): Promise<{ job: DiscoveryJob; claimToken: string } | null> {
      const now = Date.now();
      const candidates = [...globalState.jobs.values()]
        .filter((job) => {
          if (job.status !== "queued") return false;
          if (job.cancelRequested) return false;
          if (job.claimExpiresAt && Date.parse(job.claimExpiresAt) > now) return false;
          return true;
        })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      const job = candidates[0];
      if (!job) return null;

      const claimToken = randomUUID();
      job.claimToken = claimToken;
      job.claimedAt = nowIso();
      job.claimExpiresAt = new Date(now + leaseMs).toISOString();
      job.workerId = workerId;
      job.status = "planning";
      job.startedAt = job.startedAt ?? nowIso();
      globalState.jobs.set(job.id, job);
      return { job: { ...job }, claimToken };
    },

    async heartbeatClaim(jobId, claimToken, leaseMs): Promise<boolean> {
      const job = globalState.jobs.get(jobId);
      if (!job || job.claimToken !== claimToken) return false;
      job.claimExpiresAt = new Date(Date.now() + leaseMs).toISOString();
      globalState.jobs.set(jobId, job);
      return true;
    },
  };
}
