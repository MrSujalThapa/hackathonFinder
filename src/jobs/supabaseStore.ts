/**
 * Supabase-backed discovery job repository.
 * Requires migrations 006_discovery_jobs.sql and
 * 008_atomic_discovery_events.sql to be applied.
 */

import { randomUUID } from "node:crypto";
import { createServiceSupabaseClient } from "@/lib/supabase/createServiceClient";
import {
  sanitizeEventMetadata,
  type DiscoveryEvent,
  type DiscoveryEventLevel,
  type DiscoveryEventType,
} from "@/discovery/events";
import type { SourceName } from "@/core/discovery/types";
import {
  ACTIVE_JOB_STATUSES,
  type CreateDiscoveryJobInput,
  type DiscoveryJob,
  type DiscoveryJobRepository,
  type DiscoveryJobStatus,
  type ListJobsParams,
} from "@/jobs/types";

type JobRow = {
  id: string;
  command: string;
  status: DiscoveryJobStatus;
  requested_sources: string[];
  effective_sources: string[];
  mode: DiscoveryJob["mode"];
  dry_run: boolean;
  all_sources: boolean;
  max_agent_calls: number | null;
  progress: number;
  current_stage: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  failure_category: string | null;
  safe_error_message: string | null;
  agent_run_id: string | null;
  created_count: number;
  updated_count: number;
  accepted_count: number;
  rejected_count: number;
  needs_review_count: number;
  raw_leads_count: number;
  duration_ms: number | null;
  claim_token: string | null;
  claimed_at: string | null;
  claim_expires_at: string | null;
  worker_id: string | null;
  cancel_requested: boolean;
  summary: Record<string, unknown> | null;
};

type EventRow = {
  id: string;
  job_id: string;
  sequence: number;
  event_type: DiscoveryEventType;
  level: DiscoveryEventLevel;
  source: string | null;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type SupabaseClientLike = {
  from: (table: string) => unknown;
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: SupabaseDbError | null }>;
};

type SupabaseDbError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  status?: number;
};

export type DiscoveryDbErrorKind =
  | "schema_unavailable"
  | "unique_conflict"
  | "authorization"
  | "temporary"
  | "unknown";

function mapJob(row: JobRow): DiscoveryJob {
  return {
    id: row.id,
    command: row.command,
    status: row.status,
    requestedSources: row.requested_sources as SourceName[],
    effectiveSources: row.effective_sources as SourceName[],
    mode: row.mode,
    dryRun: row.dry_run,
    allSources: row.all_sources,
    maxAgentCalls: row.max_agent_calls,
    progress: row.progress,
    currentStage: row.current_stage,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    failureCategory: row.failure_category,
    safeErrorMessage: row.safe_error_message,
    agentRunId: row.agent_run_id,
    createdCount: row.created_count,
    updatedCount: row.updated_count,
    acceptedCount: row.accepted_count,
    rejectedCount: row.rejected_count,
    needsReviewCount: row.needs_review_count,
    rawLeadsCount: row.raw_leads_count,
    durationMs: row.duration_ms,
    claimToken: row.claim_token,
    claimedAt: row.claimed_at,
    claimExpiresAt: row.claim_expires_at,
    workerId: row.worker_id,
    cancelRequested: row.cancel_requested,
    summary: row.summary,
  };
}

function mapEvent(row: EventRow): DiscoveryEvent {
  return {
    id: row.id,
    runId: row.job_id,
    sequence: row.sequence,
    timestamp: row.created_at,
    type: row.event_type,
    level: row.level,
    source: row.source ?? undefined,
    message: row.message,
    metadata: row.metadata ?? undefined,
  };
}

function errorText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error ?? "unknown");
  const db = error as SupabaseDbError;
  return [db.message, db.details, db.hint].filter(Boolean).join(" | ") || "unknown";
}

export function classifyDiscoveryDbError(error: unknown): DiscoveryDbErrorKind {
  const db = (error ?? {}) as SupabaseDbError;
  const code = db.code;
  const status = db.status;
  const text = errorText(error).toLowerCase();

  if (
    code === "42P01" ||
    code === "42703" ||
    code === "42883" ||
    code === "PGRST202" ||
    code === "PGRST204" ||
    /relation .* does not exist|column .* does not exist|function .* does not exist|could not find .*function|schema cache/.test(
      text,
    )
  ) {
    return "schema_unavailable";
  }
  if (code === "23505" || /duplicate key value violates unique constraint/.test(text)) {
    return "unique_conflict";
  }
  if (
    code === "42501" ||
    status === 401 ||
    status === 403 ||
    /row-level security|permission denied|not authorized|unauthorized|forbidden|jwt/.test(
      text,
    )
  ) {
    return "authorization";
  }
  if (
    /fetch failed|network|econnreset|econnrefused|enotfound|etimedout|timeout|temporarily unavailable/.test(
      text,
    )
  ) {
    return "temporary";
  }
  return "unknown";
}

function discoveryDbErrorMessage(
  error: unknown,
  context: { operation: string; migrationHint?: string },
): string {
  const kind = classifyDiscoveryDbError(error);
  const text = errorText(error);
  switch (kind) {
    case "schema_unavailable":
      return `Discovery job database schema unavailable while ${context.operation}: ${text}. Apply ${context.migrationHint ?? "the pending Supabase migrations"}.`;
    case "unique_conflict":
      return `Discovery job database unique conflict while ${context.operation}: ${text}.`;
    case "authorization":
      return `Discovery job database authorization/configuration error while ${context.operation}: ${text}. Check service-role server configuration and RLS.`;
    case "temporary":
      return `Temporary discovery job database error while ${context.operation}: ${text}.`;
    default:
      return `Discovery job database error while ${context.operation}: ${text}.`;
  }
}

function throwDiscoveryDbError(
  error: unknown,
  context: { operation: string; migrationHint?: string },
): never {
  throw new Error(discoveryDbErrorMessage(error, context));
}

function isUniqueConflict(error: unknown): boolean {
  return classifyDiscoveryDbError(error) === "unique_conflict";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jobPatchToRow(
  patch: Parameters<DiscoveryJobRepository["updateJob"]>[1],
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.progress !== undefined) row.progress = patch.progress;
  if (patch.currentStage !== undefined) row.current_stage = patch.currentStage;
  if (patch.effectiveSources !== undefined) {
    row.effective_sources = patch.effectiveSources;
  }
  if (patch.failureCategory !== undefined) {
    row.failure_category = patch.failureCategory;
  }
  if (patch.safeErrorMessage !== undefined) {
    row.safe_error_message = patch.safeErrorMessage;
  }
  if (patch.agentRunId !== undefined) row.agent_run_id = patch.agentRunId;
  if (patch.createdCount !== undefined) row.created_count = patch.createdCount;
  if (patch.updatedCount !== undefined) row.updated_count = patch.updatedCount;
  if (patch.acceptedCount !== undefined) row.accepted_count = patch.acceptedCount;
  if (patch.rejectedCount !== undefined) {
    row.rejected_count = patch.rejectedCount;
  }
  if (patch.needsReviewCount !== undefined) {
    row.needs_review_count = patch.needsReviewCount;
  }
  if (patch.rawLeadsCount !== undefined) row.raw_leads_count = patch.rawLeadsCount;
  if (patch.durationMs !== undefined) row.duration_ms = patch.durationMs;
  if (patch.summary !== undefined) row.summary = patch.summary;
  if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
  if (patch.cancelledAt !== undefined) row.cancelled_at = patch.cancelledAt;
  return row;
}

export function createSupabaseDiscoveryJobStore(
  client?: SupabaseClientLike,
): DiscoveryJobRepository {
  // discovery_jobs tables are added by migration 006; regenerate database.types after apply.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (client ?? createServiceSupabaseClient()) as any;

  return {
    async createJob(input: CreateDiscoveryJobInput): Promise<DiscoveryJob> {
      const { data, error } = await supabase
        .from("discovery_jobs")
        .insert({
          command: input.command,
          status: "queued",
          requested_sources: input.requestedSources ?? [],
          effective_sources: [],
          mode: input.mode ?? "auto",
          dry_run: input.dryRun === true,
          all_sources: input.allSources === true,
          max_agent_calls: input.maxAgentCalls ?? null,
          progress: 0,
          current_stage: "queued",
        })
        .select("*")
        .single();

      if (error) {
        throwDiscoveryDbError(error, {
          operation: "creating discovery job",
          migrationHint: "supabase/migrations/006_discovery_jobs.sql",
        });
      }
      return mapJob(data as JobRow);
    },

    async getJob(id: string): Promise<DiscoveryJob | null> {
      const { data, error } = await supabase
        .from("discovery_jobs")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) {
        throwDiscoveryDbError(error, {
          operation: "reading discovery job",
          migrationHint: "supabase/migrations/006_discovery_jobs.sql",
        });
      }
      return data ? mapJob(data as JobRow) : null;
    },

    async listJobs(params: ListJobsParams = {}): Promise<DiscoveryJob[]> {
      const limit = params.limit ?? 20;
      let query = supabase
        .from("discovery_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (params.status) query = query.eq("status", params.status);
      const { data, error } = await query;
      if (error) {
        throwDiscoveryDbError(error, {
          operation: "listing discovery jobs",
          migrationHint: "supabase/migrations/006_discovery_jobs.sql",
        });
      }
      return (data as JobRow[]).map(mapJob);
    },

    async countActiveJobs(): Promise<number> {
      const { count, error } = await supabase
        .from("discovery_jobs")
        .select("id", { count: "exact", head: true })
        .in("status", ACTIVE_JOB_STATUSES);
      if (error) {
        throwDiscoveryDbError(error, {
          operation: "counting active discovery jobs",
          migrationHint: "supabase/migrations/006_discovery_jobs.sql",
        });
      }
      return count ?? 0;
    },

    async requestCancel(id: string): Promise<DiscoveryJob | null> {
      const existing = await this.getJob(id);
      if (!existing) return null;
      if (["completed", "failed", "cancelled"].includes(existing.status)) {
        return existing;
      }

      const { data, error } = await supabase
        .from("discovery_jobs")
        .update({ cancel_requested: true })
        .eq("id", id)
        .select("*")
        .single();
      if (error) {
        throwDiscoveryDbError(error, {
          operation: "requesting discovery job cancellation",
          migrationHint: "supabase/migrations/006_discovery_jobs.sql",
        });
      }
      return mapJob(data as JobRow);
    },

    async markStarted(id, patch = {}): Promise<DiscoveryJob> {
      const { data, error } = await supabase
        .from("discovery_jobs")
        .update({
          status: patch.status ?? "planning",
          started_at: new Date().toISOString(),
          current_stage: patch.currentStage ?? patch.status ?? "planning",
          effective_sources: patch.effectiveSources,
          agent_run_id: patch.agentRunId,
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error) {
        throwDiscoveryDbError(error, {
          operation: "marking discovery job started",
          migrationHint: "supabase/migrations/006_discovery_jobs.sql",
        });
      }
      return mapJob(data as JobRow);
    },

    async updateJob(id, patch): Promise<DiscoveryJob> {
      const row = jobPatchToRow(patch);

      const { data, error } = await supabase
        .from("discovery_jobs")
        .update(row)
        .eq("id", id)
        .select("*")
        .single();
      if (error) {
        throwDiscoveryDbError(error, {
          operation: "updating discovery job",
          migrationHint: "supabase/migrations/006_discovery_jobs.sql",
        });
      }
      return mapJob(data as JobRow);
    },

    async transitionToTerminal(id, patch, event) {
      const row = jobPatchToRow(patch);
      const { data, error } = await supabase
        .from("discovery_jobs")
        .update(row)
        .eq("id", id)
        .in("status", ACTIVE_JOB_STATUSES)
        .select("*")
        .maybeSingle();
      if (error) {
        throwDiscoveryDbError(error, {
          operation: "transitioning discovery job to terminal state",
          migrationHint: "supabase/migrations/006_discovery_jobs.sql",
        });
      }
      if (!data) {
        const current = await this.getJob(id);
        return current ? { job: current, event: null, transitioned: false } : null;
      }
      const saved = await this.appendEvent(id, event);
      return { job: mapJob(data as JobRow), event: saved, transitioned: true };
    },

    async appendEvent(jobId, partial): Promise<DiscoveryEvent> {
      const createdAt = partial.timestamp ?? new Date().toISOString();
      let lastError: SupabaseDbError | null = null;

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const { data, error } = await supabase.rpc("append_discovery_job_event", {
          p_job_id: jobId,
          p_event_type: partial.type,
          p_level: partial.level,
          p_message: partial.message,
          p_id: partial.id ?? randomUUID(),
          p_source: partial.source ?? null,
          p_metadata: sanitizeEventMetadata(partial.metadata) ?? {},
          p_created_at: createdAt,
        });
        if (!error) return mapEvent(data as EventRow);
        lastError = error;
        if (!isUniqueConflict(error) || attempt === 3) break;
        await sleep(15 * attempt);
      }

      throwDiscoveryDbError(lastError, {
        operation: "appending discovery job event",
        migrationHint: "supabase/migrations/008_atomic_discovery_events.sql",
      });
    },

    async listEvents(jobId, options = {}): Promise<DiscoveryEvent[]> {
      const after = options.afterSequence ?? 0;
      const limit = options.limit ?? 500;
      const { data, error } = await supabase
        .from("discovery_job_events")
        .select("*")
        .eq("job_id", jobId)
        .gt("sequence", after)
        .order("sequence", { ascending: true })
        .limit(limit);
      if (error) {
        throwDiscoveryDbError(error, {
          operation: "listing discovery job events",
          migrationHint: "supabase/migrations/006_discovery_jobs.sql",
        });
      }
      return (data as EventRow[]).map(mapEvent);
    },

    async claimNextJob(workerId, leaseMs) {
      const now = new Date();
      const { data: candidates, error } = await supabase
        .from("discovery_jobs")
        .select("*")
        .eq("status", "queued")
        .eq("cancel_requested", false)
        .order("created_at", { ascending: true })
        .limit(5);
      if (error) {
        throwDiscoveryDbError(error, {
          operation: "claiming queued discovery job",
          migrationHint: "supabase/migrations/006_discovery_jobs.sql",
        });
      }

      for (const row of (candidates as JobRow[]) ?? []) {
        if (row.claim_expires_at && Date.parse(row.claim_expires_at) > now.getTime()) {
          continue;
        }
        const claimToken = randomUUID();
        const { data, error: updateError } = await supabase
          .from("discovery_jobs")
          .update({
            claim_token: claimToken,
            claimed_at: now.toISOString(),
            claim_expires_at: new Date(now.getTime() + leaseMs).toISOString(),
            worker_id: workerId,
            status: "planning",
            started_at: row.started_at ?? now.toISOString(),
          })
          .eq("id", row.id)
          .eq("status", "queued")
          .select("*")
          .maybeSingle();
        if (updateError) {
          throwDiscoveryDbError(updateError, {
            operation: "claiming queued discovery job",
            migrationHint: "supabase/migrations/006_discovery_jobs.sql",
          });
        }
        if (data) {
          return { job: mapJob(data as JobRow), claimToken };
        }
      }
      return null;
    },

    async heartbeatClaim(jobId, claimToken, leaseMs): Promise<boolean> {
      const { data, error } = await supabase
        .from("discovery_jobs")
        .update({
          claim_expires_at: new Date(Date.now() + leaseMs).toISOString(),
        })
        .eq("id", jobId)
        .eq("claim_token", claimToken)
        .select("id")
        .maybeSingle();
      if (error) {
        throwDiscoveryDbError(error, {
          operation: "heartbeating discovery job claim",
          migrationHint: "supabase/migrations/006_discovery_jobs.sql",
        });
      }
      return Boolean(data);
    },
  };
}
