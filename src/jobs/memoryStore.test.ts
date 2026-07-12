import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  createMemoryDiscoveryJobStore,
  resetMemoryDiscoveryJobStoreForTests,
} from "@/jobs/memoryStore";
import { setDiscoveryJobStoreForTests } from "@/jobs/store";
import { executeDiscoveryJob } from "@/jobs/executor";

describe("discovery job store (memory)", () => {
  beforeEach(() => {
    resetMemoryDiscoveryJobStoreForTests();
    setDiscoveryJobStoreForTests(createMemoryDiscoveryJobStore());
    process.env.DISCOVERY_JOB_STORE = "memory";
    process.env.DISCOVERY_EXECUTION_MODE = "worker";
  });

  it("creates jobs and appends ordered events", async () => {
    const store = createMemoryDiscoveryJobStore();
    setDiscoveryJobStoreForTests(store);
    const job = await store.createJob({
      command: "find upcoming AI hackathons",
      dryRun: true,
      requestedSources: ["mock"],
    });
    assert.equal(job.status, "queued");

    const e1 = await store.appendEvent(job.id, {
      type: "run_queued",
      level: "info",
      message: "queued",
    });
    const e2 = await store.appendEvent(job.id, {
      type: "run_started",
      level: "info",
      message: "started",
    });
    assert.equal(e1.sequence, 1);
    assert.equal(e2.sequence, 2);

    const listed = await store.listEvents(job.id, { afterSequence: 1 });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.sequence, 2);
  });

  it("claims queued jobs for workers", async () => {
    const store = createMemoryDiscoveryJobStore();
    setDiscoveryJobStoreForTests(store);
    await store.createJob({ command: "find hackathons", dryRun: true });
    const claimed = await store.claimNextJob("worker-a", 30_000);
    assert.ok(claimed);
    assert.equal(claimed.job.status, "planning");
    assert.ok(claimed.claimToken);

    const none = await store.claimNextJob("worker-b", 30_000);
    assert.equal(none, null);
  });

  it("cancels queued jobs immediately", async () => {
    const store = createMemoryDiscoveryJobStore();
    setDiscoveryJobStoreForTests(store);
    const job = await store.createJob({ command: "find hackathons", dryRun: true });
    const cancelled = await store.requestCancel(job.id);
    assert.equal(cancelled?.status, "cancelled");
  });

  it("executes a dry-run job via shared service", async () => {
    const store = createMemoryDiscoveryJobStore();
    setDiscoveryJobStoreForTests(store);
    const job = await store.createJob({
      command: "find upcoming hackathons",
      dryRun: true,
      requestedSources: ["mock"],
      mode: "deterministic",
    });

    const finished = await executeDiscoveryJob({
      jobId: job.id,
      workerId: "test-worker",
    });
    assert.equal(finished.status, "completed");
    assert.ok((finished.acceptedCount ?? 0) >= 1);
    const events = await store.listEvents(job.id);
    assert.ok(events.some((event) => event.type === "run_completed"));
  });
});
