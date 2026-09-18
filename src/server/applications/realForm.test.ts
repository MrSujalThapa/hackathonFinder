import assert from "node:assert/strict";
import test from "node:test";
import type { ApplicationDraft } from "@/core/applications/types";
import { beginSubmission } from "@/core/applications/workflow";
import { submitRealExternalForm } from "@/server/applications/realForm";

/**
 * These cover only the synchronous authorization/target guards at the top of
 * submitRealExternalForm — they reject before any browser is launched, so
 * they run fast and deterministically. The actual fill/reconcile/click
 * behavior requires a live page and is verified via a real external form in
 * this project's manual acceptance pass, not the fast unit suite (same
 * convention as the rest of realForm.ts, which has no direct unit tests for
 * its Playwright-driven functions).
 */
const baseDraft = (overrides: Partial<ApplicationDraft> = {}): ApplicationDraft => ({
  id: "draft-1",
  opportunityId: "opp-1",
  applicationUrl: "https://example.com/apply",
  status: "ready_to_submit",
  draftVersion: 3,
  approvedDraftVersion: null,
  approvedAt: null,
  currentPage: 1,
  totalPages: 1,
  checkpoint: {},
  questions: [
    { id: "q1", label: "Name", fieldType: "text", required: true, options: [], selector: "#name", answer: "Ada", answerSource: "user", needsUserInput: false },
  ],
  ...overrides,
});

test("rejects a real URL without any Submit now authorization", async () => {
  await assert.rejects(() => submitRealExternalForm(baseDraft()));
});

test("rejects a real URL when authorization was recorded for a different draft version", async () => {
  const draft = baseDraft({
    draftVersion: 3,
    checkpoint: { submissionAuthorization: { draftVersion: 2, authorizedAt: "2026-01-01T00:00:00.000Z" } },
  });
  await assert.rejects(() => submitRealExternalForm(draft));
});

test("the authorization guard (beginSubmission) passes once Submit now was recorded for this exact draft version", () => {
  // submitRealExternalForm's guard IS beginSubmission — verified directly
  // here (pure, no browser) rather than by letting submitRealExternalForm
  // proceed past it into a real network navigation, which the fast suite
  // must not depend on.
  const draft = baseDraft({
    draftVersion: 3,
    checkpoint: { submissionAuthorization: { draftVersion: 3, authorizedAt: "2026-01-01T00:00:00.000Z" } },
  });
  assert.doesNotThrow(() => beginSubmission(draft));
});

test("refuses to run the general real-form path against the controlled fixture URL, even when authorized", async () => {
  const draft = baseDraft({
    applicationUrl: "http://localhost:3000/fixtures/controlled-application",
    draftVersion: 1,
    checkpoint: { submissionAuthorization: { draftVersion: 1, authorizedAt: "2026-01-01T00:00:00.000Z" } },
  });
  await assert.rejects(() => submitRealExternalForm(draft), /local fixture/i);
});
