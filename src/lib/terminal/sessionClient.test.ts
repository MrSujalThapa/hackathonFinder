import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createClientSession,
  findSessionByTarget,
  formatSessionListLine,
  metaFromSessions,
} from "@/lib/terminal/sessionClient";

describe("sessionClient", () => {
  it("creates sessions with isolated empty buffers", () => {
    const a = createClientSession({ title: "Alpha" });
    const b = createClientSession({ title: "Beta" });
    assert.notEqual(a.id, b.id);
    assert.equal(a.title, "Alpha");
    assert.equal(a.lines.length, 1);
    assert.equal(a.history.length, 0);
    assert.equal(a.activeJobId, null);
    assert.equal(a.lastSequence, 0);
  });

  it("finds sessions by title or id prefix", () => {
    const a = createClientSession({ title: "research" });
    const b = createClientSession({ title: "canada-ai" });
    const list = [a, b];
    assert.equal(findSessionByTarget(list, "research")?.id, a.id);
    assert.equal(findSessionByTarget(list, a.id.slice(0, 8))?.id, a.id);
    assert.equal(findSessionByTarget(list, "canada")?.id, b.id);
    assert.equal(findSessionByTarget(list, "missing"), null);
  });

  it("formats list lines with active marker", () => {
    const a = createClientSession({ title: "One" });
    const line = formatSessionListLine(a, a.id);
    assert.match(line, /^\*/);
    assert.match(line, /One/);
  });

  it("builds persistable meta without lines", () => {
    const a = createClientSession({ title: "One" });
    const meta = metaFromSessions([a], a.id);
    assert.equal(meta.activeId, a.id);
    assert.equal(meta.sessions[0]?.title, "One");
    assert.equal(meta.sessions[0]?.id, a.id);
  });
});
