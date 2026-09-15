import { beginSubmission } from "@/core/applications/workflow";
import type { ApplicationDraft } from "@/core/applications/types";

export type ApprovedFill = { selector: string; value: string };

/** Safe bridge for browser automation: validates approval but never submits. */
export function createApprovedFillPlan(draft: ApplicationDraft): ApprovedFill[] {
  beginSubmission(draft);
  return draft.questions.filter((question) => Boolean(question.answer) && Boolean(question.selector)).map((question) => ({ selector: question.selector, value: question.answer! }));
}
