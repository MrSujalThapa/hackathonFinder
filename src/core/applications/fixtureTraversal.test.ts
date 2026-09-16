import assert from "node:assert/strict";
import test from "node:test";
import { editAnswer } from "@/core/applications/workflow";
import { fourPageApplicationFixture, runControlledFixtureWorker } from "@/core/applications/fixtureTraversal";
import type { ApplicationDraft } from "@/core/applications/types";
const initial = (): ApplicationDraft => ({ id: "fixture", opportunityId: "opportunity", applicationUrl: "https://fixture.invalid/apply", status: "drafting", draftVersion: 1, approvedDraftVersion: null, approvedAt: null, currentPage: 1, totalPages: 4, checkpoint: {}, questions: [] });
test("four page worker stops, exits, resumes as a fresh run, and never reaches submit", () => {
  const first = runControlledFixtureWorker(initial());
  assert.equal(first.pagesVisited, 1); assert.equal(first.draft.status, "needs_input");
  assert.deepEqual(first.events.filter((event) => event.type === "blocker")[0], { type: "blocker", page: 1, questionIds: ["attendance", "consent"] });
  assert.equal(first.draft.questions.find((question) => question.id === "name")?.answerSource, "profile");
  assert.equal(first.draft.questions.find((question) => question.id === "attendance")?.answer, null);
  const answered = editAnswer(editAnswer(first.draft, "attendance", "Yes"), "consent", "Yes");
  const second = runControlledFixtureWorker({ ...answered, status: "drafting" });
  assert.equal(second.draft.checkpoint.workerRun, 2); assert.equal(second.pagesVisited, 4); assert.equal(second.draft.currentPage, 4);
  assert.equal(second.draft.questions.find((question) => question.id === "github")?.answerSource, "asset_bank");
  assert.equal(second.draft.questions.find((question) => question.id === "resume")?.answer, "storage/resume.pdf");
  assert.deepEqual(second.events.filter((event) => event.type === "blocker")[0], { type: "blocker", page: 4, questionIds: ["travel"] });
  assert.equal(second.events.some((event) => event.type === "stopped" && event.reason === "possible_submit"), false);
  assert.equal(fourPageApplicationFixture[3]?.action.type, "submit");
});
test("paused and auth-required drafts are durable no-op worker exits", () => {
  for (const status of ["paused", "auth_required"] as const) {
    const result = runControlledFixtureWorker({ ...initial(), status });
    assert.equal(result.pagesVisited, 0); assert.equal(result.draft.status, status);
  }
});
