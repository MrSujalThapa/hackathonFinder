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

/** Domain sources accepted by `/source …` commands. */
export const TERMINAL_SOURCE_NAMES = [
  "mlh",
  "web",
  "hacklist",
  "devpost",
  "luma",
  "hakku",
] as const;

export type TerminalSourceName = (typeof TERMINAL_SOURCE_NAMES)[number];

export type SourceCommandAction =
  | "status"
  | "check"
  | "connect"
  | "disconnect"
  | "enable"
  | "disable";

export type SiteCommandAction =
  | "save"
  | "list"
  | "status"
  | "check"
  | "enable"
  | "disable"
  | "remove"
  | "configure";

export type TerminalHelpTopic =
  | "general"
  | "find"
  | "source"
  | "terminals";

/**
 * Typed internal commands produced by the terminal parser.
 * Never shell-executable — UI/runtime maps these to domain APIs only.
 */
export type ParsedTerminalCommand =
  | {
      kind: "find";
      request: string;
      raw: string;
      includeCustomSites?: boolean;
      sources?: string[];
      reviewPolicy?: "broad" | "balanced" | "strict";
      profile?: "light" | "standard" | "deep" | "exhaustive";
      dryRun?: boolean;
      remotePolicy?: "exclude" | "include" | "only" | "inferred_open";
      onsiteOnly?: boolean;
    }
  | { kind: "sources"; raw: string }
  | { kind: "status"; raw: string }
  | { kind: "history"; raw: string }
  | { kind: "jobs"; raw: string }
  | { kind: "cancel"; jobId?: string; raw: string }
  | { kind: "clear"; raw: string }
  | { kind: "help"; topic: TerminalHelpTopic; raw: string }
  | { kind: "new"; raw: string }
  | { kind: "terminals"; raw: string }
  | { kind: "switch"; target: string; raw: string }
  | { kind: "rename"; name: string; raw: string }
  | { kind: "close"; target?: string; raw: string }
  | {
      kind: "source";
      action: SourceCommandAction;
      source: TerminalSourceName;
      raw: string;
    }
  | {
      kind: "confirm";
      action: "disconnect";
      source: TerminalSourceName;
      raw: string;
    }
  | {
      kind: "site";
      action: SiteCommandAction;
      name?: string;
      url?: string;
      mode?: "auto" | "static" | "playwright";
      location?: string;
      topics?: string[];
      maxItems?: number;
      enabled?: boolean;
      selectors?: {
        cardSelector?: string;
        titleSelector?: string;
        linkSelector?: string;
        strategy?: "auto" | "cards" | "table" | "list";
        titleColumn?: string;
        dateColumn?: string;
        typeColumn?: string;
        urlColumn?: string;
      };
      raw: string;
    }
  | {
      kind: "confirm_site";
      action: "remove";
      name: string;
      raw: string;
    }
  | {
      kind: "rejected";
      reason: string;
      message: string;
      suggestion?: string;
      raw: string;
    }
  | { kind: "empty"; raw: string };

export type CreateDiscoveryJobInput = {
  command: string;
  sources?: string[];
  terminalSessionId?: string;
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
