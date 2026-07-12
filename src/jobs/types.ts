import type { DiscoveryEvent } from "@/discovery/events";
import type { SourceName } from "@/core/discovery/types";

export const DISCOVERY_JOB_STATUSES = [
  "queued",
  "planning",
  "collecting",
  "enriching",
  "verifying",
  "persisting",
  "completed",
  "failed",
  "cancelled",
] as const;

export type DiscoveryJobStatus = (typeof DISCOVERY_JOB_STATUSES)[number];

export type DiscoveryJob = {
  id: string;
  command: string;
  status: DiscoveryJobStatus;
  requestedSources: SourceName[];
  effectiveSources: SourceName[];
  mode: "auto" | "agent" | "deterministic";
  dryRun: boolean;
  allSources: boolean;
  maxAgentCalls: number | null;
  progress: number;
  currentStage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  failureCategory: string | null;
  safeErrorMessage: string | null;
  agentRunId: string | null;
  createdCount: number;
  updatedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  needsReviewCount: number;
  rawLeadsCount: number;
  durationMs: number | null;
  /** Worker claim metadata for retry-safe polling. */
  claimToken: string | null;
  claimedAt: string | null;
  claimExpiresAt: string | null;
  workerId: string | null;
  cancelRequested: boolean;
  summary: Record<string, unknown> | null;
};

export type CreateDiscoveryJobInput = {
  command: string;
  requestedSources?: SourceName[];
  mode?: DiscoveryJob["mode"];
  dryRun?: boolean;
  maxAgentCalls?: number;
  allSources?: boolean;
};

export type DiscoveryJobEventRow = DiscoveryEvent & {
  jobId: string;
};

export type ListJobsParams = {
  limit?: number;
  status?: DiscoveryJobStatus;
};

export type ClaimJobResult = {
  job: DiscoveryJob;
  claimToken: string;
} | null;

export type DiscoveryJobRepository = {
  createJob: (input: CreateDiscoveryJobInput) => Promise<DiscoveryJob>;
  getJob: (id: string) => Promise<DiscoveryJob | null>;
  listJobs: (params?: ListJobsParams) => Promise<DiscoveryJob[]>;
  countActiveJobs: () => Promise<number>;
  requestCancel: (id: string) => Promise<DiscoveryJob | null>;
  markStarted: (
    id: string,
    patch?: Partial<
      Pick<DiscoveryJob, "effectiveSources" | "currentStage" | "status" | "agentRunId">
    >,
  ) => Promise<DiscoveryJob>;
  updateJob: (
    id: string,
    patch: Partial<
      Pick<
        DiscoveryJob,
        | "status"
        | "progress"
        | "currentStage"
        | "effectiveSources"
        | "failureCategory"
        | "safeErrorMessage"
        | "agentRunId"
        | "createdCount"
        | "updatedCount"
        | "acceptedCount"
        | "rejectedCount"
        | "needsReviewCount"
        | "rawLeadsCount"
        | "durationMs"
        | "summary"
        | "completedAt"
        | "cancelledAt"
      >
    >,
  ) => Promise<DiscoveryJob>;
  appendEvent: (
    jobId: string,
    event: Omit<DiscoveryEvent, "id" | "runId" | "sequence" | "timestamp"> & {
      id?: string;
      sequence?: number;
      timestamp?: string;
    },
  ) => Promise<DiscoveryEvent>;
  listEvents: (
    jobId: string,
    options?: { afterSequence?: number; limit?: number },
  ) => Promise<DiscoveryEvent[]>;
  /** Claim next queued job for a worker. Returns null when none available. */
  claimNextJob: (workerId: string, leaseMs: number) => Promise<ClaimJobResult>;
  heartbeatClaim: (jobId: string, claimToken: string, leaseMs: number) => Promise<boolean>;
};

export const ACTIVE_JOB_STATUSES: DiscoveryJobStatus[] = [
  "queued",
  "planning",
  "collecting",
  "enriching",
  "verifying",
  "persisting",
];
