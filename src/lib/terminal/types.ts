/**
 * Terminal UI types for the controlled discovery console.
 * Job/event shapes mirror the discovery job API contract (see docs/discovery/TERMINAL.md).
 */

export type TerminalEventLevel = "info" | "success" | "warning" | "error";

export type DiscoveryJobStatus =
  | "queued"
  | "planning"
  | "collecting"
  | "enriching"
  | "verifying"
  | "persisting"
  | "completed"
  | "failed"
  | "cancelled";

export type DiscoveryJobSummary = {
  rawLeads?: number;
  uniqueLeads?: number;
  accepted?: number;
  rejected?: number;
  needsReview?: number;
  created?: number;
  updated?: number;
  durationMs?: number;
  llmCalls?: number;
  fallbackUsed?: boolean;
  sourceCounts?: Record<string, number>;
  [key: string]: unknown;
};

export type DiscoveryJob = {
  id: string;
  command: string;
  status: DiscoveryJobStatus;
  requestedSources?: string[];
  effectiveSources?: string[];
  currentStage?: string | null;
  progress?: number | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  failureCategory?: string | null;
  safeErrorMessage?: string | null;
  summary?: DiscoveryJobSummary | null;
  createdCount?: number | null;
  updatedCount?: number | null;
  acceptedCount?: number | null;
  rejectedCount?: number | null;
  needsReviewCount?: number | null;
};

export type DiscoveryJobEvent = {
  id: string;
  /** Job id — API may send `jobId` or `runId`. */
  jobId: string;
  sequence: number;
  timestamp: string;
  type: string;
  level: TerminalEventLevel;
  source?: string | null;
  message: string;
  metadata?: Record<string, unknown> | null;
};

export type SourceHealthStatus =
  | "healthy"
  | "degraded"
  | "auth_required"
  | "unconfigured"
  | "disabled"
  | "failed"
  | "unknown";

export type SourceHealth = {
  source: string;
  status: SourceHealthStatus;
  enabled: boolean;
  authenticated?: boolean;
  lastCheckedAt?: string | null;
  lastSuccessfulAt?: string | null;
  durationMs?: number | null;
  leadsFound?: number | null;
  accepted?: number | null;
  failureCategory?: string | null;
  safeMessage?: string | null;
  capabilities?: {
    publicDiscovery?: boolean;
    authenticatedDiscovery?: boolean;
    browserRequired?: boolean;
  };
};

export type TerminalLineKind =
  | "prompt"
  | "system"
  | "event"
  | "help"
  | "error"
  | "warning"
  | "success"
  | "summary";

export type TerminalLine = {
  id: string;
  kind: TerminalLineKind;
  text: string;
  level?: TerminalEventLevel;
  source?: string | null;
  timestamp?: string;
  /** When set, line came from a live job event. */
  eventSequence?: number;
  jobId?: string;
};

export type ParsedTerminalCommand =
  | { kind: "find"; request: string; raw: string }
  | { kind: "sources"; raw: string }
  | { kind: "status"; raw: string }
  | { kind: "history"; raw: string }
  | { kind: "cancel"; raw: string }
  | { kind: "clear"; raw: string }
  | { kind: "help"; raw: string }
  | { kind: "rejected"; reason: string; message: string; raw: string }
  | { kind: "empty"; raw: string };

export type CreateDiscoveryJobInput = {
  command: string;
  sources?: string[];
  dryRun?: boolean;
  maxAgentCalls?: number;
  mode?: "auto" | "agent" | "deterministic";
  allSources?: boolean;
};

export type CreateDiscoveryJobResult = {
  job: DiscoveryJob;
};

export type ListDiscoveryJobsResult = {
  jobs: DiscoveryJob[];
};

export type GetDiscoveryJobResult = {
  job: DiscoveryJob;
};

export type CancelDiscoveryJobResult = {
  job: DiscoveryJob;
};

export type ListSourceHealthResult = {
  sources: SourceHealth[];
};
