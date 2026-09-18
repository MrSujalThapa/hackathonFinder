import { authorizeSubmission, completeSubmission } from "@/core/applications/workflow";
import type { ApplicationDraft } from "@/core/applications/types";
import { getApplication, saveDraft } from "@/server/applications/repository";
import { fillAndPreviewRealForm, submitControlledRealForm, type RealFormRun } from "@/server/applications/realForm";
import { notify } from "@/server/notifications/service";

export async function previewSubmission(id: string): Promise<ApplicationDraft> {
  const draft = await getApplication(id); if (!draft) throw new Error("Application not found.");
  if (["user_managed", "submitted"].includes(draft.status)) throw new Error("This draft cannot be previewed by automation.");
  const preview = await fillAndPreviewRealForm(draft);
  return saveDraft({ ...draft, checkpoint: { ...draft.checkpoint, realFormPreview: { at: new Date().toISOString(), page: preview.page, reconciliation: preview.reconciliation } } });
}

/** The caller's Submit now action is the authorization. Nothing else can submit. */
export async function submitAuthorizedDraft(id: string): Promise<ApplicationDraft> {
  const draft = await getApplication(id); if (!draft) throw new Error("Application not found.");
  let authorized = await saveDraft(authorizeSubmission(draft));
  let result: RealFormRun;
  try {
    result = await submitControlledRealForm(authorized);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Controlled submission failed.";
    authorized = await saveDraft({ ...authorized, status: "ready_to_submit", checkpoint: { ...authorized.checkpoint, submissionError: { at: new Date().toISOString(), message } } });
    await notify({ type: "SUBMISSION_FAILED", priority: 1, opportunityId: authorized.opportunityId, applicationId: authorized.id, title: "Application submission stopped", body: message, actionUrl: `/drafts/${authorized.id}`, dedupeKey: `submission-error:${authorized.draftVersion}` });
    return authorized;
  }
  if (!result.reconciliation.ok || !result.confirmation) {
    authorized = await saveDraft({ ...authorized, status: "ready_to_submit", checkpoint: { ...authorized.checkpoint, finalReconciliation: { at: new Date().toISOString(), ...result.reconciliation } } });
    await notify({ type: "SUBMISSION_FAILED", priority: 1, opportunityId: authorized.opportunityId, applicationId: authorized.id, title: "Application submission blocked", body: "The persisted draft does not match the real form. Review the saved reconciliation mismatches.", actionUrl: `/drafts/${authorized.id}`, dedupeKey: `reconciliation:${authorized.draftVersion}` });
    return authorized;
  }
  return saveDraft(completeSubmission(authorized, result.confirmation));
}
