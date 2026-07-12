/**
 * Supabase-backed discovery job repository.
 * Requires migration 006_discovery_jobs.sql to be applied.
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

function tableMissingMessage(error: { message?: string }): string {
  return `Discovery job tables unavailable (${error.message ?? "unknown"}). Apply supabase/migrations/006_discovery_jobs.sql or use the DEV-ONLY in-memory store in development.`;
}

export function createSupabaseDiscoveryJobStore(): DiscoveryJobRepository {
  // discovery_jobs tables are added by migration 006; regenerate database.types after apply.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceSupabaseClient() as any;

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

      if (error) throw new Error(tableMissingMessage(error));
      return mapJob(data as JobRow);
    },

    async getJob(id: string): Promise<DiscoveryJob | null> {
      const { data, error } = await supabase
        .from("discovery_jobs")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(tableMissingMessage(error));
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
      if (error) throw new Error(tableMissingMessage(error));
      return (data as JobRow[]).map(mapJob);
    },

    async countActiveJobs(): Promise<number> {
      const { count, error } = await supabase
        .from("discovery_jobs")
        .select("id", { count: "exact", head: true })
        .in("status", ACTIVE_JOB_STATUSES);
      if (error) throw new Error(tableMissingMessage(error));
      return count ?? 0;
    },

    async requestCancel(id: string): Promise<DiscoveryJob | null> {
      const existing = await this.getJob(id);
      if (!existing) return null;
      if (["completed", "failed", "cancelled"].includes(existing.status)) {
        return existing;
      }

      const patch =
        existing.status === "queued"
          ? {
              cancel_requested: true,
              status: "cancelled",
              cancelled_at: new Date().toISOString(),
              completed_at: new Date().toISOString(),
              current_stage: "cancelled",
            }
          : { cancel_requested: true };

      const { data, error } = await supabase
        .from("discovery_jobs")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(tableMissingMessage(error));
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
      if (error) throw new Error(tableMissingMessage(error));
      return mapJob(data as JobRow);
    },

    async updateJob(id, patch): Promise<DiscoveryJob> {
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

      const { data, error } = await supabase
        .from("discovery_jobs")
        .update(row)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(tableMissingMessage(error));
      return mapJob(data as JobRow);
    },

    async appendEvent(jobId, partial): Promise<DiscoveryEvent> {
      // Allocate sequence via max+1; unique index enforces safety under concurrency.
      const { data: latest } = await supabase
        .from("discovery_job_events")
        .select("sequence")
        .eq("job_id", jobId)
        .order("sequence", { ascending: false })
        .limit(1)
        .maybeSingle();

      const sequence = partial.sequence ?? ((latest?.sequence as number | undefined) ?? 0) + 1;
      const id = partial.id ?? randomUUID();
      const createdAt = partial.timestamp ?? new Date().toISOString();

      const { data, error } = await supabase
        .from("discovery_job_events")
        .insert({
          id,
          job_id: jobId,
          sequence,
          event_type: partial.type,
          level: partial.level,
          source: partial.source ?? null,
          message: partial.message,
          metadata: sanitizeEventMetadata(partial.metadata) ?? {},
          created_at: createdAt,
        })
        .select("*")
        .single();

      if (error) throw new Error(tableMissingMessage(error));
      return mapEvent(data as EventRow);
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
      if (error) throw new Error(tableMissingMessage(error));
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
      if (error) throw new Error(tableMissingMessage(error));

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
        if (updateError) throw new Error(tableMissingMessage(updateError));
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
      if (error) throw new Error(tableMissingMessage(error));
      return Boolean(data);
    },
  };
}
