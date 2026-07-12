import { getServerEnv, hasGoogleSheetsConfig, hasLlmConfig, hasSupabaseConfig, hasXConfig } from "@/config/env";
import { createServiceSupabaseClient } from "@/lib/supabase/createServiceClient";

export type OwnerDiagnostics = {
  config: {
    supabase: "configured" | "missing";
    sheets: "configured" | "missing";
    llm: "configured" | "missing";
    x: "configured" | "not_configured";
    mockCandidates: "enabled" | "disabled";
    providerModel: string;
  };
  latestAgentRun: {
    status: string;
    sources: string[];
    startedAt: string;
    finishedAt: string | null;
    newCandidates: number;
    updatedCandidates: number;
    rejected: number;
  } | null;
  lastSheetSync: {
    candidateName: string;
    sheetAppendedAt: string;
  } | null;
};

export async function getOwnerDiagnostics(): Promise<OwnerDiagnostics> {
  const env = getServerEnv();
  const diagnostics: OwnerDiagnostics = {
    config: {
      supabase: hasSupabaseConfig(env) ? "configured" : "missing",
      sheets: hasGoogleSheetsConfig(env) ? "configured" : "missing",
      llm: hasLlmConfig(env) ? "configured" : "missing",
      x: hasXConfig(env) ? "configured" : "not_configured",
      mockCandidates: env.USE_MOCK_CANDIDATES ? "enabled" : "disabled",
      providerModel: [env.LLM_PROVIDER ?? "deterministic", env.LLM_MODEL]
        .filter(Boolean)
        .join("/"),
    },
    latestAgentRun: null,
    lastSheetSync: null,
  };

  if (!hasSupabaseConfig(env)) return diagnostics;

  const supabase = createServiceSupabaseClient();
  const [{ data: run }, { data: sheetCandidate }] = await Promise.all([
    supabase
      .from("agent_runs")
      .select("status,sources,started_at,finished_at,new_candidates_count,updated_candidates_count,rejected_count")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("candidates")
      .select("name,sheet_appended_at")
      .not("sheet_appended_at", "is", null)
      .order("sheet_appended_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (run) {
    diagnostics.latestAgentRun = {
      status: run.status,
      sources: run.sources ?? [],
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      newCandidates: run.new_candidates_count ?? 0,
      updatedCandidates: run.updated_candidates_count ?? 0,
      rejected: run.rejected_count ?? 0,
    };
  }

  if (sheetCandidate?.sheet_appended_at) {
    diagnostics.lastSheetSync = {
      candidateName: sheetCandidate.name,
      sheetAppendedAt: sheetCandidate.sheet_appended_at,
    };
  }

  return diagnostics;
}
