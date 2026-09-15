import { inspectApplicationForm } from "@/core/applications/formInspection";
import { draftApplication } from "@/core/applications/workflow";
import { createLlmProviderOptional } from "@/lib/llm/createProvider";
import { createApplication, getProfile, listQuestionBank, saveDraft } from "@/server/applications/repository";
import { inspectApplicationUrl } from "@/server/applications/inspectForm";
import { notify } from "@/server/notifications/service";

export async function prepareApplication(input: { candidateId: string; applicationUrl: string; formHtml?: string }) {
  const inspected = input.formHtml
    ? { questions: inspectApplicationForm(input.formHtml), blocker: null }
    : await inspectApplicationUrl(input.applicationUrl);
  let draft = await createApplication(input.candidateId, input.applicationUrl, inspected.questions);
  if (inspected.blocker) {
    draft = await saveDraft({ ...draft, status: "needs_input" });
    await notify({ type: "APPLICATION_NEEDS_INPUT", opportunityId: draft.opportunityId, applicationId: draft.id, title: "Application needs your attention", body: `Inspection paused because ${inspected.blocker} requires your interaction.`, actionUrl: `/applications/${draft.id}` });
    return { application: draft, metrics: null, blocker: inspected.blocker };
  }
  const llm = createLlmProviderOptional();
  if (!llm) return { application: draft, metrics: null, blocker: null };
  const result = await draftApplication(draft, await getProfile(), await listQuestionBank(), llm);
  draft = await saveDraft(result.draft);
  if (draft.status === "needs_input" || draft.status === "ready_for_review") {
    await notify({ type: draft.status === "needs_input" ? "APPLICATION_NEEDS_INPUT" : "APPLICATION_READY_FOR_REVIEW", opportunityId: draft.opportunityId, applicationId: draft.id, title: draft.status === "needs_input" ? "Application needs your input" : "Application ready for review", body: draft.status === "needs_input" ? "Everything resolvable has been drafted; complete the remaining required fields." : "Your application draft is ready for review.", actionUrl: `/applications/${draft.id}` });
  }
  return { application: draft, metrics: result.metrics, blocker: null };
}
