import type { ApplicationDraft, ApplicationQuestion, AnswerSource } from "@/core/applications/types";
import { classifyFormAction } from "@/core/applications/navigationSafety";

export type ControlledPage = { page: number; questions: ApplicationQuestion[]; action: { type: string; text: string } };
export type FixtureWorkerEvent = { type: "blocker"; page: number; questionIds: string[] } | { type: "stopped"; page: number; reason: "needs_input" | "possible_submit" };
export type FixtureWorkerDependencies = { save(draft: ApplicationDraft): Promise<void>; notify(input: { page: number; questionIds: string[]; dedupeKey: string }): Promise<void> };
const sources: Record<string, { value: string; source: AnswerSource }> = {
  name: { value: "Ada Lovelace", source: "profile" },
  bio: { value: "Student builder.", source: "question_bank" },
  github: { value: "https://github.com/ada", source: "asset_bank" },
  resume: { value: "storage/resume.pdf", source: "asset_bank" },
};
const fixtureQuestion = (id: string, label: string, required = true, fieldType = "text"): ApplicationQuestion => ({ id, label, fieldType, required, options: [], selector: `#${id}`, answer: null, answerSource: "unresolved", needsUserInput: false });

/** A controlled four-page fixture; the final page intentionally exposes no safely-clickable action. */
export const fourPageApplicationFixture: ControlledPage[] = [
  { page: 1, questions: [fixtureQuestion("name", "Name"), fixtureQuestion("attendance", "Can you attend all days?", true, "radio"), fixtureQuestion("consent", "Do you consent to the code of conduct?", true, "radio")], action: { type: "button", text: "Next" } },
  { page: 2, questions: [fixtureQuestion("bio", "Short bio")], action: { type: "button", text: "Continue" } },
  { page: 3, questions: [fixtureQuestion("github", "GitHub profile"), fixtureQuestion("resume", "Upload your resume", true, "file")], action: { type: "button", text: "Next" } },
  { page: 4, questions: [fixtureQuestion("travel", "Can you arrange travel?", true, "radio")], action: { type: "submit", text: "Complete application" } },
];

export function runControlledFixtureWorker(previous: ApplicationDraft, pages = fourPageApplicationFixture): { draft: ApplicationDraft; events: FixtureWorkerEvent[]; pagesVisited: number } {
  if (["paused", "user_managed", "auth_required"].includes(previous.status)) return { draft: previous, events: [{ type: "stopped", page: previous.currentPage ?? 1, reason: "needs_input" }], pagesVisited: 0 };
  let draft = { ...previous, questions: [...previous.questions], checkpoint: { ...previous.checkpoint, workerRun: Number(previous.checkpoint.workerRun ?? 0) + 1 } };
  const events: FixtureWorkerEvent[] = []; let pagesVisited = 0;
  for (const page of pages.filter((item) => item.page >= (draft.currentPage ?? 1))) {
    pagesVisited++;
    const known = new Map(draft.questions.map((question) => [question.id, question]));
    for (const question of page.questions) {
      const existing = known.get(question.id);
      if (existing) continue;
      const resolved = sources[question.id];
      draft.questions.push(resolved ? { ...question, answer: resolved.value, answerSource: resolved.source } : question);
    }
    draft.currentPage = page.page; draft.totalPages = pages.length;
    const blockers = draft.questions.filter((question) => page.questions.some((visible) => visible.id === question.id) && question.required && !question.answer);
    if (blockers.length) {
      draft = { ...draft, status: "needs_input", draftVersion: draft.draftVersion + 1 };
      events.push({ type: "blocker", page: page.page, questionIds: blockers.map((question) => question.id) }, { type: "stopped", page: page.page, reason: "needs_input" });
      return { draft, events, pagesVisited };
    }
    const safety = classifyFormAction({ type: page.action.type, text: page.action.text, currentPage: page.page, totalPages: pages.length });
    if (safety !== "SAFE_NAVIGATION") {
      draft = { ...draft, status: "ready_to_submit", draftVersion: draft.draftVersion + 1 };
      events.push({ type: "stopped", page: page.page, reason: "possible_submit" });
      return { draft, events, pagesVisited };
    }
  }
  return { draft, events, pagesVisited };
}

/** Durable fixture harness: every worker turn saves once, then emits only its blocker batch. */
export async function runDurableFixtureWorker(previous: ApplicationDraft, dependencies: FixtureWorkerDependencies, pages = fourPageApplicationFixture): Promise<{ draft: ApplicationDraft; events: FixtureWorkerEvent[]; pagesVisited: number }> {
  const result = runControlledFixtureWorker(previous, pages);
  await dependencies.save(result.draft);
  for (const event of result.events) if (event.type === "blocker") await dependencies.notify({ page: event.page, questionIds: event.questionIds, dedupeKey: `page:${event.page}:${event.questionIds.join(",")}` });
  return result;
}
