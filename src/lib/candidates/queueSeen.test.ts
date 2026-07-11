import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Window } from "happy-dom";
import {
  SESSION_SEEN_KEY,
  addSeenId,
  clearSeenIds,
  readSeenIds,
  removeSeenId,
  unseeCandidate,
  writeSeenIds,
} from "@/lib/candidates/queueSeen";

describe("queueSeen", () => {
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
  });

  afterEach(() => {
    windowRef.happyDOM.close();
  });

  it("reads and writes seen ids", () => {
    writeSeenIds(new Set(["a", "b"]));
    assert.deepEqual([...readSeenIds()].sort(), ["a", "b"]);
    assert.equal(sessionStorage.getItem(SESSION_SEEN_KEY), '["a","b"]');
  });

  it("addSeenId is idempotent", () => {
    addSeenId("x");
    addSeenId("x");
    assert.deepEqual([...readSeenIds()], ["x"]);
  });

  it("removeSeenId / unseeCandidate clears an id", () => {
    writeSeenIds(new Set(["a", "b"]));
    removeSeenId("a");
    assert.deepEqual([...readSeenIds()], ["b"]);
    unseeCandidate("b");
    assert.deepEqual([...readSeenIds()], []);
  });

  it("clearSeenIds removes the session key", () => {
    addSeenId("z");
    clearSeenIds();
    assert.equal(sessionStorage.getItem(SESSION_SEEN_KEY), null);
    assert.equal(readSeenIds().size, 0);
  });

  it("seen state does not hide authoritative NEW after unsee", () => {
    addSeenId("restored-1");
    assert.ok(readSeenIds().has("restored-1"));
    unseeCandidate("restored-1");
    assert.ok(!readSeenIds().has("restored-1"));
  });
});
