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

  it("keeps terminal output, history, drafts, scroll, and selected jobs isolated", () => {
    const a = createClientSession({ title: "AI Canada" });
    const b = createClientSession({ title: "Robotics" });
    const c = createClientSession({ title: "Remote Students" });

    a.lines = [
      ...a.lines,
      { id: "a-out", kind: "event", text: "[mlh] AI Canada result" },
    ];
    b.lines = [
      ...b.lines,
      { id: "b-out", kind: "event", text: "[devpost] Robotics result" },
    ];
    c.lines = [
      ...c.lines,
      { id: "c-out", kind: "system", text: "[queued] position 1" },
    ];

    a.history = ["/find AI Canada hackathons"];
    b.history = ["/find robotics hackathons"];
    c.history = ["/find remote student hackathons"];

    a.draft = "follow up ai";
    b.draft = "follow up robotics";
    c.draft = "follow up remote";

    a.scrollTop = 10;
    b.scrollTop = 200;
    c.scrollTop = 30;

    a.activeJobId = "job-a";
    b.activeJobId = "job-b";
    c.activeJobId = "job-c";

    assert.match(a.lines.map((line) => line.text).join("\n"), /AI Canada/);
    assert.doesNotMatch(a.lines.map((line) => line.text).join("\n"), /Robotics/);
    assert.deepEqual(b.history, ["/find robotics hackathons"]);
    assert.equal(c.draft, "follow up remote");
    assert.equal(b.scrollTop, 200);
    assert.equal(a.activeJobId, "job-a");
    assert.equal(c.activeJobId, "job-c");
  });
});
