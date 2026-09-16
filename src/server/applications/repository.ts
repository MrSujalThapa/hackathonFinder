import { randomUUID } from "node:crypto";
import { createServiceSupabaseClient } from "@/lib/supabase/createServiceClient";
import type { ApplicationDraft, ApplicationQuestion, ApplicationStatus, AssetBankEntry, Profile, QuestionBankEntry } from "@/core/applications/types";

const OWNER_ID = "00000000-0000-0000-0000-000000000001";
const statuses = new Set<ApplicationStatus>(["not_started", "scheduled", "drafting", "auth_required", "needs_input", "needs_file", "paused", "ready_to_submit", "user_managed", "ready_for_review", "approved", "submitting", "submitted", "failed"]);

function mapQuestion(row: { id: string; question: string; field_type: string; required: boolean; answer: string | null; answer_source: string; needs_user_input: boolean; form_selector: string | null; options: unknown; max_length: number | null }): ApplicationQuestion {
  return { id: row.id, label: row.question, fieldType: row.field_type, required: row.required, answer: row.answer, answerSource: row.answer_source as ApplicationQuestion["answerSource"], needsUserInput: row.needs_user_input, selector: row.form_selector ?? "", options: Array.isArray(row.options) ? row.options.filter((value): value is string => typeof value === "string") : [], maxLength: row.max_length ?? undefined };
}

async function getDraft(id: string): Promise<ApplicationDraft | null> {
  const db = createServiceSupabaseClient();
  const { data: application, error } = await db.from("applications").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load application: ${error.message}`);
  if (!application) return null;
  const { data: questions, error: questionError } = await db.from("application_questions").select("*").eq("application_id", id).order("position");
  if (questionError) throw new Error(`Could not load application questions: ${questionError.message}`);
  return { id: application.id, opportunityId: application.candidate_id, applicationUrl: application.application_url, status: application.status as ApplicationStatus, draftVersion: application.draft_version, approvedDraftVersion: application.approved_draft_version, approvedAt: application.approved_at, submittedAt: application.submitted_at ?? null, currentPage: application.current_page ?? null, totalPages: application.total_pages ?? null, checkpoint: application.checkpoint && typeof application.checkpoint === "object" && !Array.isArray(application.checkpoint) ? application.checkpoint as Record<string, unknown> : {}, updatedAt: application.updated_at, questions: (questions ?? []).map(mapQuestion) };
}

export async function listApplications(): Promise<ApplicationDraft[]> {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.from("applications").select("id").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not list applications: ${error.message}`);
  const drafts = await Promise.all((data ?? []).map(({ id }) => getDraft(id)));
  return drafts.filter((draft): draft is ApplicationDraft => Boolean(draft));
}

export async function getApplication(id: string): Promise<ApplicationDraft | null> { return getDraft(id); }

export async function createApplication(candidateId: string, applicationUrl: string, questions: ApplicationQuestion[], checkpoint: Record<string, unknown> = {}): Promise<ApplicationDraft> {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.from("applications").insert({ candidate_id: candidateId, application_url: applicationUrl, status: "drafting", checkpoint: checkpoint as never }).select("*").single();
  if (error) throw new Error(`Could not create application: ${error.message}`);
  if (questions.length) {
    const { error: questionError } = await db.from("application_questions").insert(questions.map((question, position) => ({ id: randomUUID(), application_id: data.id, question: question.label, field_type: question.fieldType, required: question.required, answer: question.answer, answer_source: question.answerSource, needs_user_input: question.needsUserInput, form_selector: question.selector || null, options: question.options, max_length: question.maxLength ?? null, position })));
    if (questionError) throw new Error(`Could not persist extracted questions: ${questionError.message}`);
  }
  const draft = await getDraft(data.id); if (!draft) throw new Error("Created application could not be reloaded."); return draft;
}

export async function saveDraft(draft: ApplicationDraft): Promise<ApplicationDraft> {
  const db = createServiceSupabaseClient();
  if (!statuses.has(draft.status)) throw new Error("Invalid application status.");
  const { error } = await db.from("applications").update({ status: draft.status, draft_version: draft.draftVersion, approved_at: draft.approvedAt, approved_draft_version: draft.approvedDraftVersion, approved_by: draft.status === "approved" ? OWNER_ID : null, submitted_at: draft.submittedAt ?? null, current_page: draft.currentPage, total_pages: draft.totalPages, checkpoint: draft.checkpoint as never }).eq("id", draft.id);
  if (error) throw new Error(`Could not save application: ${error.message}`);
  for (const question of draft.questions) {
    const { error: questionError } = await db.from("application_questions").update({ answer: question.answer, answer_source: question.answerSource, needs_user_input: question.needsUserInput }).eq("id", question.id).eq("application_id", draft.id);
    if (questionError) throw new Error(`Could not save answer: ${questionError.message}`);
  }
  const saved = await getDraft(draft.id); if (!saved) throw new Error("Saved application could not be reloaded."); return saved;
}

export async function getProfile(): Promise<Profile> {
  const db = createServiceSupabaseClient(); const { data, error } = await db.from("user_profiles").select("fields").eq("user_id", OWNER_ID).maybeSingle();
  if (error) throw new Error(`Could not load profile: ${error.message}`);
  return data?.fields && typeof data.fields === "object" && !Array.isArray(data.fields) ? Object.fromEntries(Object.entries(data.fields).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
}
export async function saveProfile(fields: Profile): Promise<Profile> {
  const db = createServiceSupabaseClient(); const { error } = await db.from("user_profiles").upsert({ user_id: OWNER_ID, fields }); if (error) throw new Error(`Could not save profile: ${error.message}`); return fields;
}
export async function listQuestionBank(): Promise<QuestionBankEntry[]> {
  const db = createServiceSupabaseClient(); const { data, error } = await db.from("question_bank").select("*").eq("user_id", OWNER_ID).order("updated_at", { ascending: false }); if (error) throw new Error(`Could not load Question Bank: ${error.message}`); return (data ?? []).map((row) => ({ id: row.id, canonicalQuestion: row.canonical_question, answer: row.answer, aliases: row.aliases, tags: row.tags, updatedAt: row.updated_at }));
}
export async function upsertQuestionBank(entry: Omit<QuestionBankEntry, "updatedAt">): Promise<QuestionBankEntry> {
  const db = createServiceSupabaseClient(); const { data, error } = await db.from("question_bank").upsert({ id: entry.id, user_id: OWNER_ID, canonical_question: entry.canonicalQuestion, answer: entry.answer, aliases: entry.aliases, tags: entry.tags }).select("*").single(); if (error) throw new Error(`Could not save Question Bank entry: ${error.message}`); return { id: data.id, canonicalQuestion: data.canonical_question, answer: data.answer, aliases: data.aliases, tags: data.tags, updatedAt: data.updated_at };
}
export async function deleteQuestionBank(id: string): Promise<void> { const db = createServiceSupabaseClient(); const { error } = await db.from("question_bank").delete().eq("id", id).eq("user_id", OWNER_ID); if (error) throw new Error(`Could not delete Question Bank entry: ${error.message}`); }

export async function listAssetBank(): Promise<AssetBankEntry[]> {
  const db = createServiceSupabaseClient(); const { data, error } = await db.from("asset_bank").select("*").eq("user_id", OWNER_ID).order("updated_at", { ascending: false }); if (error) throw new Error(`Could not load Asset Bank: ${error.message}`);
  return (data ?? []).map((row) => ({ id: row.id, label: row.label, kind: row.kind as AssetBankEntry["kind"], assetType: row.asset_type, value: row.value, filename: row.filename, notes: row.notes, isDefault: row.is_default, updatedAt: row.updated_at }));
}
export async function upsertAssetBank(entry: Omit<AssetBankEntry, "updatedAt">): Promise<AssetBankEntry> {
  const db = createServiceSupabaseClient(); const { data, error } = await db.from("asset_bank").upsert({ id: entry.id, user_id: OWNER_ID, label: entry.label, kind: entry.kind, asset_type: entry.assetType, value: entry.value, filename: entry.filename, notes: entry.notes, is_default: entry.isDefault }).select("*").single(); if (error) throw new Error(`Could not save Asset Bank entry: ${error.message}`);
  return { id: data.id, label: data.label, kind: data.kind as AssetBankEntry["kind"], assetType: data.asset_type, value: data.value, filename: data.filename, notes: data.notes, isDefault: data.is_default, updatedAt: data.updated_at };
}
export async function deleteAssetBank(id: string): Promise<void> { const db = createServiceSupabaseClient(); const { error } = await db.from("asset_bank").delete().eq("id", id).eq("user_id", OWNER_ID); if (error) throw new Error(`Could not delete Asset Bank entry: ${error.message}`); }
export async function deleteApplication(id: string): Promise<void> { const db = createServiceSupabaseClient(); const { error } = await db.from("applications").delete().eq("id", id); if (error) throw new Error(`Could not delete application: ${error.message}`); }
export async function findApplicationByOpportunityName(query: string): Promise<ApplicationDraft | null> {
  const db = createServiceSupabaseClient(); const { data: candidates, error } = await db.from("candidates").select("id,name").ilike("name", `%${query.trim()}%`).limit(2); if (error) throw new Error(`Could not find opportunity: ${error.message}`);
  if (!candidates?.length) return null;
  const { data: applications, error: appError } = await db.from("applications").select("id,candidate_id").in("candidate_id", candidates.map((candidate) => candidate.id)); if (appError) throw new Error(`Could not load application: ${appError.message}`);
  if (!applications?.length) return null;
  if (applications.length > 1) throw new Error("More than one active application draft matches that name.");
  return getDraft(applications[0]!.id);
}
