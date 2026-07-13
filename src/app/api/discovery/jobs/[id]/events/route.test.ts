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
});
