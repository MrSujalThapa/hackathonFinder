import { randomUUID } from "node:crypto";
import { loadLocalEnv } from "@/cli/loadEnv";
loadLocalEnv();
async function main(): Promise<void> {
  const { createServiceSupabaseClient } = await import("@/lib/supabase/createServiceClient");
  const { createApplication, getApplication, saveDraft, upsertAssetBank } = await import("@/server/applications/repository");
  const kind = ["browser", "gateway_acceptance", "resume"].includes(process.env.APPLICATION_FIXTURE_KIND ?? "") ? process.env.APPLICATION_FIXTURE_KIND! : "gateway";
  const db = createServiceSupabaseClient(); const fingerprint = `pass1-${kind}-fixture-hackmit`;
  const { data: existing, error: findError } = await db.from("candidates").select("id").eq("fingerprint", fingerprint).maybeSingle(); if (findError) throw findError;
  let candidateId = existing?.id;
  if (!candidateId) { const name = kind === "browser" ? "HackMIT Browser Delete Fixture" : kind === "gateway_acceptance" ? "HackMIT Gateway Acceptance Fixture" : kind === "resume" ? "HackMIT Browser Resume Fixture" : "HackMIT Gateway Fixture"; const { data, error } = await db.from("candidates").insert({ name, source: "pass1_fixture", fingerprint, score: 0, apply_url: "https://fixture.invalid/hackmit", themes: [], why_match: [], red_flags: [] }).select("id").single(); if (error) throw error; candidateId = data.id; }
  const { data: existingApp, error: appFindError } = await db.from("applications").select("id").eq("candidate_id", candidateId).maybeSingle(); if (appFindError) throw appFindError;
  const questions = [
    { id: randomUUID(), label: "GitHub profile", fieldType: "text", required: true, options: [], selector: "#github", answer: "https://github.com/fixture", answerSource: "asset_bank" as const, needsUserInput: false },
    { id: randomUUID(), label: "Upload your resume", fieldType: "file", required: true, options: [], selector: "#resume", answer: "fixture/resume.pdf", answerSource: "asset_bank" as const, needsUserInput: false },
    { id: randomUUID(), label: "Why do you want to attend?", fieldType: "textarea", required: true, options: [], selector: "#why", answer: null, answerSource: "unresolved" as const, needsUserInput: true },
  ];
  let application = existingApp ? await getApplication(existingApp.id) : await createApplication(candidateId, "https://fixture.invalid/hackmit", questions, { fixture: true, workerRun: 0 });
  if (!application) throw new Error("Could not create fixture application.");
  application = await saveDraft({ ...application, status: "needs_input", currentPage: 1, totalPages: 4, checkpoint: { fixture: true, workerRun: 0 } });
  await upsertAssetBank({ id: randomUUID(), label: "Fixture GitHub", kind: "link", assetType: "github", value: "https://github.com/fixture", filename: null, notes: "Pass 1 fixture", isDefault: false });
  await upsertAssetBank({ id: randomUUID(), label: "Fixture resume", kind: "file", assetType: "resume", value: "fixture/resume.pdf", filename: "resume.pdf", notes: "Pass 1 fixture", isDefault: false });
  console.log(JSON.stringify({ kind, candidateId, applicationId: application.id }));
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
