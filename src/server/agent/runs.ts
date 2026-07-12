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
  const { error } = await supabase
    .from("agent_runs")
    .update({
      status,
      raw_leads_count: summary.rawLeads,
      parsed_events_count: summary.extracted,
      new_candidates_count: summary.stored - summary.duplicatesUpdated,
      updated_candidates_count: summary.duplicatesUpdated,
      rejected_count: summary.rejected,
      errors: summary.errors,
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
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (error) {
    throw new Error(`Failed to complete agent run: ${error.message}`);
  }
}
