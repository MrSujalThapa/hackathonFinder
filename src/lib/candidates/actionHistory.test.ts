import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildActionHistory,
  formatTechnicalRefreshSummary,
  isTechnicalAction,
} from "@/lib/candidates/actionHistory";
import type { CandidateAction } from "@/core/candidates/types";

function action(
  overrides: Partial<CandidateAction> & Pick<CandidateAction, "action" | "createdAt">,
): CandidateAction {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    candidateId: "c1",
    previousStatus: overrides.previousStatus ?? null,
    newStatus: overrides.newStatus ?? null,
    reason: null,
    metadata: overrides.metadata ?? {},
    ...overrides,
  };
}

describe("actionHistory", () => {
  it("treats UPDATE_FROM_DUPLICATE and no-op transitions as technical", () => {
    assert.equal(
      isTechnicalAction(
        action({
          action: "UPDATE_FROM_DUPLICATE",
          createdAt: "2026-07-12T10:00:00Z",
        }),
      ),
      true,
    );
    assert.equal(
      isTechnicalAction(
        action({
          action: "ENRICH",
          previousStatus: "NEW",
          newStatus: "NEW",
          createdAt: "2026-07-12T10:00:00Z",
        }),
      ),
      true,
    );
  });

  it("collapses technical actions and caps meaningful ones", () => {
    const actions = [
      action({ action: "APPROVE", createdAt: "2026-07-12T12:00:00Z" }),
      action({
        action: "UPDATE_FROM_DUPLICATE",
        createdAt: "2026-07-12T11:00:00Z",
      }),
      action({
        action: "UPDATE_FROM_DUPLICATE",
        createdAt: "2026-07-12T10:54:00Z",
      }),
      action({ action: "SAVE_FOR_LATER", createdAt: "2026-07-11T09:00:00Z" }),
    ];
    const history = buildActionHistory(actions, { meaningfulLimit: 20 });
    assert.equal(history.visible.filter((b) => b.kind === "action").length, 2);
    const summary = history.visible.find((b) => b.kind === "technical_summary");
    assert.ok(summary && summary.kind === "technical_summary");
    assert.equal(summary.count, 2);
    assert.match(
      formatTechnicalRefreshSummary(summary.count, summary.lastAt),
      /refreshed 2 times/i,
    );
  });
});
