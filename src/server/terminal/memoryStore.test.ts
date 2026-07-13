import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  createMemoryTerminalSessionStore,
  resetMemoryTerminalSessionStoreForTests,
} from "@/server/terminal/memoryStore";

afterEach(() => {
  resetMemoryTerminalSessionStoreForTests();
});

describe("memory terminal session repository", () => {
  it("supports session lifecycle and selected restore", async () => {
    const store = createMemoryTerminalSessionStore();
    const first = await store.createSession({
      id: "11111111-1111-4111-8111-111111111111",
      title: "AI Canada",
      select: true,
    });
    const second = await store.createSession({
      id: "22222222-2222-4222-8222-222222222222",
      title: "Robotics",
      select: true,
    });

    assert.equal((await store.getSession(first.id))?.title, "AI Canada");
    assert.equal((await store.getSelectedSession())?.id, second.id);
    assert.equal((await store.restoreLatestSelectedSession())?.id, second.id);

    await store.renameSession(second.id, "Robotics West");
    assert.equal(
      (await store.findSessionByTitleOrId("robotics"))?.id,
      second.id,
    );
    assert.equal(
      (await store.findSessionByTitleOrId(second.id.slice(0, 8)))?.id,
      second.id,
    );

    await store.closeSession(second.id);
    assert.equal((await store.listSessions()).length, 1);
    await store.reopenSession(second.id);
    await store.selectSession(first.id);
    assert.equal((await store.getSelectedSession())?.id, first.id);
  });

  it("attaches jobs, detaches completed active jobs, and preserves history", async () => {
    const store = createMemoryTerminalSessionStore();
    const session = await store.createSession({ title: "Remote Students" });

    await store.attachJob(session.id, "job-a");
    await store.attachJob(session.id, "job-b");
    assert.equal((await store.getSession(session.id))?.activeJobId, "job-b");
    assert.deepEqual(await store.listSessionJobIds(session.id), [
      "job-b",
      "job-a",
    ]);

    await store.detachCompletedActiveJob(session.id, "job-b");
    const updated = await store.getSession(session.id);
    assert.equal(updated?.activeJobId, null);
    assert.equal(updated?.selectedJobId, "job-b");
    assert.deepEqual(await store.listTerminalHistory(session.id), [
      "job-b",
      "job-a",
    ]);
  });

  it("stores command history per terminal", async () => {
    const store = createMemoryTerminalSessionStore();
    const a = await store.createSession({ title: "A" });
    const b = await store.createSession({ title: "B" });

    await store.appendCommandHistory(a.id, "/find ai canada");
    await store.appendCommandHistory(b.id, "/find robotics");
    await store.appendCommandHistory(a.id, "/source status hakku");

    assert.deepEqual(
      (await store.listCommandHistory(a.id)).map((entry) => entry.command),
      ["/find ai canada", "/source status hakku"],
    );
    assert.deepEqual(
      (await store.listCommandHistory(b.id)).map((entry) => entry.command),
      ["/find robotics"],
    );
  });
});
