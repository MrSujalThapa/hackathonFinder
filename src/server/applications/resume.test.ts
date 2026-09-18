import assert from "node:assert/strict";
import test from "node:test";
import { blockerNotificationKey } from "@/server/applications/resume";
import type { ApplicationDraft } from "@/core/applications/types";

const draft = (page = 1, missing = "answer"): ApplicationDraft => ({ id: "draft", opportunityId: "opportunity", applicationUrl: "https://fixture.invalid", status: "needs_input", draftVersion: 1, approvedDraftVersion: null, approvedAt: null, currentPage: page, totalPages: 2, checkpoint: {}, questions: [{ id: "profile", label: "Profile", fieldType: "text", required: true, options: [], selector: "#profile", answer: "https://example.test", answerSource: "asset_bank", needsUserInput: false }, { id: missing, label: "Why?", fieldType: "textarea", required: true, options: [], selector: "#why", answer: null, answerSource: "unresolved", needsUserInput: true }] });

test("the same persisted blocker set uses one durable notification key", () => {
  assert.equal(blockerNotificationKey(draft()), blockerNotificationKey({ ...draft(), checkpoint: { lastNotifiedBlockerKey: "page:1:answer" } }));
  assert.notEqual(blockerNotificationKey(draft(2)), blockerNotificationKey(draft()));
  assert.notEqual(blockerNotificationKey(draft(1, "new-answer")), blockerNotificationKey(draft()));
});
