import { draftApplication } from "@/core/applications/workflow";
import type { ApplicationDraft } from "@/core/applications/types";
import { createLlmProviderOptional } from "@/lib/llm/createProvider";
import { getProfile, listAssetBank, listQuestionBank, saveDraft } from "@/server/applications/repository";
import { notify } from "@/server/notifications/service";

/** One durable worker turn. It exits after every checkpoint and never submits. */
export async function resumeApplication(draft: ApplicationDraft): Promise<ApplicationDraft> {
  if (draft.status === "user_managed") return draft;
  const llm = createLlmProviderOptional();
  if (!llm) return saveDraft({ ...draft, status: draft.questions.some((q) => q.required && !q.answer) ? "needs_input" : "ready_to_submit" });
  const result = await draftApplication(draft, await getProfile(), await listQuestionBank(), llm, await listAssetBank());
  const saved = await saveDraft(result.draft);
  const blockers = saved.questions.filter((q) => q.required && !q.answer);
  if (blockers.length) await notify({ type: saved.status === "needs_file" ? "APPLICATION_NEEDS_FILE" : "APPLICATION_NEEDS_INPUT", priority: 1, opportunityId: saved.opportunityId, applicationId: saved.id, title: "Application needs your input", body: `${blockers.length} required answer${blockers.length === 1 ? "" : "s"} block progress.`, actionUrl: `/drafts/${saved.id}`, dedupeKey: `page:${saved.currentPage ?? 1}:${blockers.map((q) => q.id).join(",")}` });
  return saved;
}
