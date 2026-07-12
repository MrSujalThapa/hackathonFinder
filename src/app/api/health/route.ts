import packageJson from "../../../../package.json";
import {
  getServerEnv,
  hasGoogleSheetsConfig,
  hasLlmConfig,
  hasSupabaseConfig,
} from "@/config/env";
import { createServiceSupabaseClient } from "@/lib/supabase/createServiceClient";

type HealthResponse = {
  status: "ok" | "degraded";
  version: string;
  timestamp: string;
  checks: {
    app: "ok";
    supabase: "ok" | "degraded";
    sheets: "configured" | "unconfigured";
    llm: "configured" | "unconfigured";
  };
};

async function checkSupabase(): Promise<"ok" | "degraded"> {
  const env = getServerEnv();
  if (!hasSupabaseConfig(env)) return "degraded";
  try {
    const supabase = createServiceSupabaseClient();
    const { error } = await supabase.from("candidates").select("id").limit(1);
    return error ? "degraded" : "ok";
  } catch {
    return "degraded";
  }
}

export async function GET(): Promise<Response> {
  const env = getServerEnv();
  const supabase = await checkSupabase();
  const body: HealthResponse = {
    status: supabase === "ok" ? "ok" : "degraded",
    version: packageJson.version,
    timestamp: new Date().toISOString(),
    checks: {
      app: "ok",
      supabase,
      sheets: hasGoogleSheetsConfig(env) ? "configured" : "unconfigured",
      llm: hasLlmConfig(env) ? "configured" : "unconfigured",
    },
  };

  return Response.json(body, {
    status: body.status === "ok" ? 200 : 200,
    headers: { "cache-control": "no-store" },
  });
}
