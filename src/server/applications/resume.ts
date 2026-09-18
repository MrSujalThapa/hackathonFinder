import { draftApplication } from "@/core/applications/workflow";
import type { ApplicationDraft } from "@/core/applications/types";
import { createLlmProviderOptional } from "@/lib/llm/createProvider";
import { getProfile, listAssetBank, listQuestionBank, saveDraft } from "@/server/applications/repository";
import { notify } from "@/server/notifications/service";

export function blockerNotificationKey(draft: ApplicationDraft): string {
  return `page:${draft.currentPage ?? 1}:${draft.questions.filter((question) => question.required && !question.answer).map((question) => question.id).join(",")}`;
}

/** One durable worker turn. It exits after every checkpoint and never submits. */
export async function resumeApplication(draft: ApplicationDraft): Promise<ApplicationDraft> {
  if (draft.status === "user_managed") return draft;
  const llm = createLlmProviderOptional();
  const next = llm
    ? (await draftApplication(draft, await getProfile(), await listQuestionBank(), llm, await listAssetBank())).draft
    : { ...draft, status: draft.questions.some((question) => question.required && !question.answer) ? "needs_input" as const : "ready_to_submit" as const };
  let saved = await saveDraft(next);
  const blockers = saved.questions.filter((q) => q.required && !q.answer);
  const key = blockerNotificationKey(saved);
  if (blockers.length && saved.checkpoint.lastNotifiedBlockerKey !== key) {
    await notify({ type: saved.status === "needs_file" ? "APPLICATION_NEEDS_FILE" : "APPLICATION_NEEDS_INPUT", priority: 1, opportunityId: saved.opportunityId, applicationId: saved.id, title: "Application needs your input", body: `${blockers.length} required answer${blockers.length === 1 ? "" : "s"} block progress.`, actionUrl: `/drafts/${saved.id}`, dedupeKey: key });
    saved = await saveDraft({ ...saved, checkpoint: { ...saved.checkpoint, lastNotifiedBlockerKey: key } });
  }
  return saved;
}
