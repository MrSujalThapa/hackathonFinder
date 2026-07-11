import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Window } from "happy-dom";
import { PREVIEW_CANDIDATE } from "@/lib/candidates/preview";
import type { CandidateCard } from "@/core/candidates/types";
import {
  applyStatusChange,
  getBucket,
  getCounts,
  getQueue,
  insertIntoQueue,
  removeFromQueue,
  replaceQueue,
  resetClientStore,
  snapshot,
  restoreSnapshot,
  subscribe,
} from "@/lib/candidates/clientStore";
import {
  addSeenId,
  readSeenIds,
  unseeCandidate,
} from "@/lib/candidates/queueSeen";

function card(
  overrides: Partial<CandidateCard> & { id: string },
): CandidateCard {
  return { ...PREVIEW_CANDIDATE, ...overrides };
}

describe("clientStore", () => {
  let windowRef: Window;

  beforeEach(() => {
    windowRef = new Window({ url: "http://localhost:3000" });
    Object.defineProperty(globalThis, "window", {
      value: windowRef,
      configurable: true,
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      value: windowRef.sessionStorage,
      configurable: true,
    });
    sessionStorage.clear();
    resetClientStore();
  });

  afterEach(() => {
    resetClientStore();
    windowRef.happyDOM.close();
  });

  it("APPROVED → NEW returns to queue immediately (store + seen)", () => {
    const approved = card({ id: "c1", status: "APPROVED", name: "A" });
    applyStatusChange({
      id: "c1",
      previousStatus: "NEW",
      newStatus: "APPROVED",
      card: approved,
    });
    addSeenId("c1");
    assert.equal(getCounts().approved, 1);
    assert.ok(readSeenIds().has("c1"));

    const restored = card({ id: "c1", status: "NEW", name: "A" });
    applyStatusChange({
      id: "c1",
      previousStatus: "APPROVED",
      newStatus: "NEW",
      card: restored,
    });

    assert.equal(getCounts().approved, 0);
    assert.equal(getQueue()[0]?.id, "c1");
    assert.ok(!readSeenIds().has("c1"));
  });

  it("REJECTED → NEW returns immediately", () => {
    const rejected = card({ id: "c2", status: "REJECTED" });
    applyStatusChange({
      id: "c2",
      previousStatus: "NEW",
      newStatus: "REJECTED",
      card: rejected,
    });
    addSeenId("c2");

    applyStatusChange({
      id: "c2",
      previousStatus: "REJECTED",
      newStatus: "NEW",
      card: card({ id: "c2", status: "NEW" }),
    });

    assert.equal(getBucket("REJECTED").length, 0);
    assert.equal(getQueue()[0]?.id, "c2");
    assert.ok(!readSeenIds().has("c2"));
  });

  it("APPROVED → REJECTED → NEW returns immediately", () => {
    applyStatusChange({
      id: "c3",
      previousStatus: "NEW",
      newStatus: "APPROVED",
      card: card({ id: "c3", status: "APPROVED" }),
    });
    applyStatusChange({
      id: "c3",
      previousStatus: "APPROVED",
      newStatus: "REJECTED",
      card: card({ id: "c3", status: "REJECTED" }),
    });
    assert.equal(getCounts().rejected, 1);

    applyStatusChange({
      id: "c3",
      previousStatus: "REJECTED",
      newStatus: "NEW",
      card: card({ id: "c3", status: "NEW" }),
    });

    assert.equal(getCounts().rejected, 0);
    assert.equal(getQueue()[0]?.id, "c3");
    assert.ok(!readSeenIds().has("c3"));
  });

  it("restore while queue has other cards prepends", () => {
    replaceQueue([
      card({ id: "keep-1", status: "NEW", score: 90 }),
      card({ id: "keep-2", status: "NEW", score: 80 }),
    ]);
    addSeenId("restored");

    insertIntoQueue(card({ id: "restored", status: "NEW", score: 50 }));

    assert.deepEqual(
      getQueue().map((item) => item.id),
      ["restored", "keep-1", "keep-2"],
    );
    assert.ok(!readSeenIds().has("restored"));
  });

  it("restore when queue empty", () => {
    assert.equal(getQueue().length, 0);
    insertIntoQueue(card({ id: "only", status: "NEW" }));
    assert.deepEqual(
      getQueue().map((item) => item.id),
      ["only"],
    );
    assert.equal(getCounts().queue, 1);
  });

  it("seen state does not hide authoritative NEW after unsee", () => {
    addSeenId("auth-new");
    unseeCandidate("auth-new");
    insertIntoQueue(card({ id: "auth-new", status: "NEW" }));
    assert.ok(!readSeenIds().has("auth-new"));
    assert.equal(getQueue()[0]?.id, "auth-new");
  });

  it("removeFromQueue marks seen and supports snapshot rollback", () => {
    replaceQueue([card({ id: "q1", status: "NEW" })]);
    const snap = snapshot();
    removeFromQueue("q1");
    assert.equal(getQueue().length, 0);
    assert.ok(readSeenIds().has("q1"));

    restoreSnapshot(snap);
    assert.equal(getQueue()[0]?.id, "q1");
  });

  it("subscribe notifies listeners", () => {
    let calls = 0;
    const unsubscribe = subscribe(() => {
      calls += 1;
    });
    insertIntoQueue(card({ id: "n1", status: "NEW" }));
    assert.ok(calls >= 1);
    unsubscribe();
    const before = calls;
    insertIntoQueue(card({ id: "n2", status: "NEW" }));
    assert.equal(calls, before);
  });
});
