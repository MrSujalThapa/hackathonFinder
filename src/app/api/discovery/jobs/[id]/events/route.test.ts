import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { GET as getJobEvents } from "@/app/api/discovery/jobs/[id]/events/route";
import { createMemoryDiscoveryJobStore } from "@/jobs/memoryStore";
import { setDiscoveryJobStoreForTests } from "@/jobs/store";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";

const ORIGIN = "http://localhost";
const SECRET = "s".repeat(40);

async function authedRequest(url: string): Promise<Request> {
  process.env.APP_SESSION_SECRET = SECRET;
  const token = await createSessionToken(SECRET);
  return new Request(url, {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    },
  });
}

async function readUntil(
  response: Response,
  predicate: (text: string) => boolean,
): Promise<{ text: string; reader: ReadableStreamDefaultReader<Uint8Array> }> {
  assert.ok(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
    if (predicate(text)) return { text, reader };
  }
  throw new Error(`Timed out waiting for stream predicate. Received:\n${text}`);
}

afterEach(() => {
  setDiscoveryJobStoreForTests(null);
  delete process.env.APP_SESSION_SECRET;
});

describe("GET /api/discovery/jobs/[id]/events", () => {
  it("replays missed events after disconnect without duplicating old events", async () => {
    const store = createMemoryDiscoveryJobStore();
    setDiscoveryJobStoreForTests(store);
    const job = await store.createJob({ command: "find ai hackathons" });
    await store.appendEvent(job.id, {
      type: "run_queued",
      level: "info",
      message: "first event",
    });

    const firstResponse = await getJobEvents(
      await authedRequest(`${ORIGIN}/api/discovery/jobs/${job.id}/events?after=0`),
      { params: Promise.resolve({ id: job.id }) },
    );
    assert.equal(firstResponse.status, 200);
    const firstStream = await readUntil(firstResponse, (text) =>
      text.includes("first event"),
    );
    await firstStream.reader.cancel();

    const stillQueued = await store.getJob(job.id);
    assert.equal(stillQueued?.status, "queued");

    await store.appendEvent(job.id, {
      type: "source_progress",
      level: "info",
      message: "missed while disconnected",
    });
    await store.appendEvent(job.id, {
      type: "run_completed",
      level: "success",
      message: "job complete",
    });
    await store.updateJob(job.id, {
      status: "completed",
      progress: 100,
      currentStage: "completed",
      completedAt: new Date().toISOString(),
    });

    const reconnectResponse = await getJobEvents(
      await authedRequest(`${ORIGIN}/api/discovery/jobs/${job.id}/events?after=1`),
      { params: Promise.resolve({ id: job.id }) },
    );
    assert.equal(reconnectResponse.status, 200);
    const reconnect = await readUntil(reconnectResponse, (text) =>
      text.includes("event: end"),
    );
    await reconnect.reader.cancel().catch(() => undefined);

    assert.doesNotMatch(reconnect.text, /first event/);
    assert.equal(
      reconnect.text.match(/missed while disconnected/g)?.length,
      1,
    );
    assert.equal(reconnect.text.match(/job complete/g)?.length, 1);
    assert.equal((await store.getJob(job.id))?.status, "completed");
  });

  it("supports cursor JSON polling without full-history refetch", async () => {
    const store = createMemoryDiscoveryJobStore();
    setDiscoveryJobStoreForTests(store);
    const job = await store.createJob({ command: "find ai hackathons", dryRun: true });
    await store.appendEvent(job.id, {
      type: "run_queued",
      level: "info",
      message: "first",
    });
    await store.appendEvent(job.id, {
      type: "source_progress",
      level: "info",
      message: "second",
    });

    const response = await getJobEvents(
      await authedRequest(
        `${ORIGIN}/api/discovery/jobs/${job.id}/events?format=json&after=1`,
      ),
      { params: Promise.resolve({ id: job.id }) },
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      data: { events: Array<{ message: string }>; afterSequence: number; job: { dryRun: boolean } };
    };
    assert.equal(body.data.events.length, 1);
    assert.equal(body.data.events[0]?.message, "second");
    assert.equal(body.data.afterSequence, 2);
    assert.equal(body.data.job.dryRun, true);
  });

  it("does not append events during reconnect replay", async () => {
    const store = createMemoryDiscoveryJobStore();
    const job = await store.createJob({ command: "find ai hackathons" });
    await store.appendEvent(job.id, {
      type: "run_queued",
      level: "info",
      message: "first event",
    });
    await store.appendEvent(job.id, {
      type: "source_progress",
      level: "info",
      message: "second event",
    });
    await store.transitionToTerminal(job.id, {
      status: "completed",
      progress: 100,
      currentStage: "completed",
      completedAt: new Date().toISOString(),
    }, {
      type: "run_completed",
      level: "success",
      message: "done",
    });

    let appendCalls = 0;
    setDiscoveryJobStoreForTests({
      ...store,
      async appendEvent(jobId, event) {
        appendCalls += 1;
        return store.appendEvent(jobId, event);
      },
    });

    const response = await getJobEvents(
      await authedRequest(`${ORIGIN}/api/discovery/jobs/${job.id}/events?after=1`),
      { params: Promise.resolve({ id: job.id }) },
    );
    assert.equal(response.status, 200);
    const replay = await readUntil(response, (text) => text.includes("event: end"));
    await replay.reader.cancel().catch(() => undefined);

    assert.equal(appendCalls, 0);
    assert.doesNotMatch(replay.text, /first event/);
    assert.match(replay.text, /second event/);
    assert.match(replay.text, /done/);
  });
});
