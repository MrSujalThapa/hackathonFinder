import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { Window } from "happy-dom";
import { PREVIEW_CANDIDATE } from "@/lib/candidates/preview";
import type { CandidateCard } from "@/core/candidates/types";
import {
  applyStatusChange,
  getCounts,
  getQueue,
  insertIntoQueue,
  replaceQueue,
  resetClientStore,
} from "@/lib/candidates/clientStore";
import {
  addSeenId,
  readSeenIds,
  unseeCandidate,
} from "@/lib/candidates/queueSeen";
import { messageForSheetSync } from "@/hooks/useCandidateQueue";

function card(
  overrides: Partial<CandidateCard> & { id: string },
): CandidateCard {
  return { ...PREVIEW_CANDIDATE, ...overrides };
}

describe("queue restore + seen integration", () => {
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
    mock.restoreAll();
  });

  it("APPROVED → NEW returns to queue immediately (store + seen)", () => {
    applyStatusChange({
      id: "r1",
      previousStatus: "NEW",
      newStatus: "APPROVED",
      card: card({ id: "r1", status: "APPROVED" }),
    });
    addSeenId("r1");

    // Simulate history/detail restore path
    unseeCandidate("r1");
    insertIntoQueue(card({ id: "r1", status: "NEW" }));

    assert.equal(getQueue()[0]?.id, "r1");
    assert.ok(!readSeenIds().has("r1"));
    assert.equal(getCounts().approved, 0);
  });

  it("REJECTED → NEW returns immediately", () => {
    applyStatusChange({
      id: "r2",
      previousStatus: "NEW",
      newStatus: "REJECTED",
      card: card({ id: "r2", status: "REJECTED" }),
    });
    addSeenId("r2");

    unseeCandidate("r2");
    insertIntoQueue(card({ id: "r2", status: "NEW" }));

    assert.equal(getQueue()[0]?.id, "r2");
    assert.ok(!readSeenIds().has("r2"));
  });

  it("APPROVED → REJECTED → NEW returns immediately", () => {
    applyStatusChange({
      id: "r3",
      previousStatus: "NEW",
      newStatus: "APPROVED",
      card: card({ id: "r3", status: "APPROVED" }),
    });
    applyStatusChange({
      id: "r3",
      previousStatus: "APPROVED",
      newStatus: "REJECTED",
      card: card({ id: "r3", status: "REJECTED" }),
    });
    addSeenId("r3");

    unseeCandidate("r3");
    insertIntoQueue(card({ id: "r3", status: "NEW" }));

    assert.deepEqual(
      getQueue().map((item) => item.id),
      ["r3"],
    );
    assert.ok(!readSeenIds().has("r3"));
  });

  it("restore while queue has other cards", () => {
    replaceQueue([
      card({ id: "a", status: "NEW", score: 99 }),
      card({ id: "b", status: "NEW", score: 88 }),
    ]);
    addSeenId("restored");

    unseeCandidate("restored");
    insertIntoQueue(card({ id: "restored", status: "NEW", score: 10 }));

    assert.deepEqual(
      getQueue().map((item) => item.id),
      ["restored", "a", "b"],
    );
  });

  it("restore when queue empty", () => {
    assert.equal(getQueue().length, 0);
    unseeCandidate("solo");
    insertIntoQueue(card({ id: "solo", status: "NEW" }));
    assert.equal(getQueue().length, 1);
    assert.equal(getQueue()[0]?.id, "solo");
  });

  it("seen state does not hide authoritative NEW after unsee", () => {
    const id = "auth";
    addSeenId(id);
    const fetched = [card({ id, status: "NEW" }), card({ id: "other", status: "NEW" })];
    const seen = readSeenIds();
    let visible = fetched.filter((item) => !seen.has(item.id));
    assert.equal(visible.length, 1);

    unseeCandidate(id);
    const seenAfter = readSeenIds();
    visible = fetched.filter((item) => !seenAfter.has(item.id));
    assert.equal(visible.length, 2);
    assert.ok(visible.some((item) => item.id === id));
  });

  it("messageForSheetSync handles deleted / already_absent", () => {
    assert.match(
      messageForSheetSync({
        status: "deleted" as never,
        candidateId: "x",
      }) ?? "",
      /removed|absent/i,
    );
    assert.match(
      messageForSheetSync({
        status: "already_absent" as never,
        candidateId: "x",
      }) ?? "",
      /removed|absent/i,
    );
  });
});
