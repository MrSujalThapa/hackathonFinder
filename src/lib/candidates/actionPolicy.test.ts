import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionIdsFor, getCandidateActions } from "./actionPolicy.ts";
import type { CandidateStatus } from "@/lib/supabase/database.types";

const ALL: CandidateStatus[] = [
  "NEW",
  "NEEDS_REVIEW",
  "APPROVED",
  "REJECTED",
  "SAVED_FOR_LATER",
  "EXPIRED",
  "DUPLICATE",
  "ERROR",
];

describe("getCandidateActions", () => {
  it("NEW and NEEDS_REVIEW offer approve/save/reject only", () => {
    for (const status of ["NEW", "NEEDS_REVIEW"] as const) {
      const ids = actionIdsFor({ status });
      assert.deepEqual(ids, ["approve", "save", "reject"]);
    }
  });

  it("APPROVED never shows Approve", () => {
    const ids = actionIdsFor({ status: "APPROVED" });
    assert.ok(!ids.includes("approve"));
    assert.ok(ids.includes("reject"));
    assert.ok(ids.includes("save"));
    assert.ok(ids.includes("restore"));
  });

  it("REJECTED never shows Reject", () => {
    const ids = actionIdsFor({ status: "REJECTED" });
    assert.ok(!ids.includes("reject"));
    assert.ok(ids.includes("approve"));
    assert.ok(ids.includes("save"));
    assert.ok(ids.includes("restore"));
  });

  it("SAVED_FOR_LATER shows Unsave not Save", () => {
    const actions = getCandidateActions({ status: "SAVED_FOR_LATER" });
    const ids = actions.map((a) => a.id);
    assert.ok(!ids.includes("save"));
    assert.ok(ids.includes("unsave"));
    assert.ok(ids.includes("approve"));
    assert.ok(ids.includes("reject"));
    assert.ok(ids.includes("restore"));
    const unsave = actions.find((a) => a.id === "unsave");
    assert.equal(unsave?.apiAction, "restore");
    assert.equal(unsave?.label, "Unsave");
  });

  it("restore is secondary when present", () => {
    for (const status of ["APPROVED", "REJECTED", "SAVED_FOR_LATER"] as const) {
      const restore = getCandidateActions({ status }).find((a) => a.id === "restore");
      assert.equal(restore?.priority, "secondary");
    }
  });

  it("no status offers its own no-op primary action", () => {
    const forbidden: Record<string, string> = {
      APPROVED: "approve",
      REJECTED: "reject",
      SAVED_FOR_LATER: "save",
    };
    for (const status of ALL) {
      const ids = actionIdsFor({ status });
      const bad = forbidden[status];
      if (bad) assert.ok(!ids.includes(bad as never), `${status} must not include ${bad}`);
    }
  });

  it("covers every status with a defined matrix", () => {
    for (const status of ALL) {
      const actions = getCandidateActions({ status });
      assert.ok(Array.isArray(actions));
      assert.ok(actions.length >= 1);
    }
  });
});
