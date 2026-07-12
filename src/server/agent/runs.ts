import type { Json } from "@/lib/supabase/database.types";
import { createServiceSupabaseClient } from "@/lib/supabase/createServiceClient";
import type { AgentRunSummary } from "@/core/discovery/types";

export async function createAgentRun(input: {
  command: string;
  preferences: Json;
  sources: string[];
}) {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("agent_runs")
    .insert({
      command: input.command,
      preferences: input.preferences,
      sources: input.sources,
      status: "STARTED",
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to create agent run: ${error.message}`);
  }

  return data.id;
}

export async function completeAgentRun(
  runId: string,
  summary: AgentRunSummary,
  status: "COMPLETED" | "FAILED" | "PARTIAL" = "COMPLETED",
) {
  const supabase = createServiceSupabaseClient();
  const basePayload = {
    status,
    raw_leads_count: summary.rawLeads,
    parsed_events_count: summary.extracted,
    new_candidates_count: summary.created,
    updated_candidates_count: summary.updated,
    rejected_count: summary.rejected,
    errors: summary.errors as Json,
    finished_at: new Date().toISOString(),
  };
  const metadataPayload = {
    metadata: {
      agent: summary.agent ?? null,
      quality: summary.quality,
      sourceStats: summary.sourceStats,
      xDiscovery: summary.xDiscovery ?? null,
      counts: {
        created: summary.created,
        updated: summary.updated,
        wouldCreate: summary.wouldCreate,
        wouldUpdate: summary.wouldUpdate,
        evidenceWritten: summary.evidenceWritten,
        wouldAttachEvidence: summary.wouldAttachEvidence,
        storageFailures: summary.storageFailures,
      },
    } as Json,
  };

  let { error } = await supabase
    .from("agent_runs")
    .update({ ...basePayload, ...metadataPayload })
    .eq("id", runId);

  if (error && /metadata/i.test(error.message)) {
    const retry = await supabase
      .from("agent_runs")
      .update(basePayload)
      .eq("id", runId);
    error = retry.error;
  }

  if (error) {
    throw new Error(`Failed to complete agent run: ${error.message}`);
  }
}
