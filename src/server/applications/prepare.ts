import { inspectApplicationForm } from "@/core/applications/formInspection";
import { draftApplication } from "@/core/applications/workflow";
import { createLlmProviderOptional } from "@/lib/llm/createProvider";
import { createApplication, getProfile, listAssetBank, listQuestionBank, saveDraft } from "@/server/applications/repository";
import { inspectApplicationUrl } from "@/server/applications/inspectForm";
import { notify } from "@/server/notifications/service";

export async function prepareApplication(input: { candidateId: string; applicationUrl: string; formHtml?: string }) {
  const inspected = input.formHtml
    ? { questions: inspectApplicationForm(input.formHtml), blocker: null }
    : await inspectApplicationUrl(input.applicationUrl);
  let draft = await createApplication(input.candidateId, input.applicationUrl, inspected.questions);
  if (inspected.blocker) {
    draft = await saveDraft({ ...draft, status: ["login", "captcha", "mfa"].includes(inspected.blocker) ? "auth_required" : "needs_input", checkpoint: { blocker: inspected.blocker } });
    await notify({ type: "APPLICATION_AUTH_REQUIRED", priority: 1, opportunityId: draft.opportunityId, applicationId: draft.id, title: "Application requires your attention", body: `Inspection paused because ${inspected.blocker} requires your interaction.`, actionUrl: `/drafts/${draft.id}`, dedupeKey: `auth:${inspected.blocker}` });
    return { application: draft, metrics: null, blocker: inspected.blocker };
  }
  const llm = createLlmProviderOptional();
  if (!llm) return { application: draft, metrics: null, blocker: null };
  const result = await draftApplication(draft, await getProfile(), await listQuestionBank(), llm, await listAssetBank());
  draft = await saveDraft(result.draft);
  if (draft.status === "needs_input" || draft.status === "needs_file" || draft.status === "ready_to_submit") {
    const blockers = draft.questions.filter((q) => q.required && !q.answer);
    const isFile = draft.status === "needs_file";
    await notify({ type: isFile ? "APPLICATION_NEEDS_FILE" : draft.status === "needs_input" ? "APPLICATION_NEEDS_INPUT" : "APPLICATION_READY_TO_SUBMIT", priority: draft.status === "ready_to_submit" ? 2 : 1, opportunityId: draft.opportunityId, applicationId: draft.id, title: isFile ? "Application needs a file or link" : draft.status === "needs_input" ? "Application needs your input" : "Application draft is ready to submit", body: blockers.length ? `${blockers.length} required answer${blockers.length === 1 ? "" : "s"} are blocking progress.` : "All discovered required fields are complete. Final submission remains disabled in Pass 1.", actionUrl: `/drafts/${draft.id}`, dedupeKey: `page:${draft.currentPage ?? 1}:${blockers.map((q) => q.id).join(",") || "ready"}` });
  }
  return { application: draft, metrics: result.metrics, blocker: null };
}
