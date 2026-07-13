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
    const requested = await store.requestCancel(job.id);
    assert.equal(requested?.status, "queued");
    assert.equal(requested?.cancelRequested, true);

    const cancelled = await store.transitionToTerminal(job.id, {
      status: "cancelled",
      progress: 100,
      currentStage: "cancelled",
      cancelledAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    }, {
      type: "run_cancelled",
      level: "warning",
      message: "Cancelled while queued",
    });

    assert.equal(cancelled?.job.status, "cancelled");
    assert.equal(cancelled?.transitioned, true);
  });

  it("only creates one run_failed event for duplicate terminal transitions", async () => {
    const store = createMemoryDiscoveryJobStore();
    setDiscoveryJobStoreForTests(store);
    const job = await store.createJob({ command: "find hackathons", dryRun: true });

    const attempts = await Promise.all([
      store.transitionToTerminal(job.id, {
        status: "failed",
        progress: 100,
        currentStage: "failed",
        completedAt: new Date().toISOString(),
        failureCategory: "execution_error",
        safeErrorMessage: "boom",
      }, {
        type: "run_failed",
        level: "error",
        message: "boom",
      }),
      store.transitionToTerminal(job.id, {
        status: "failed",
        progress: 100,
        currentStage: "failed",
        completedAt: new Date().toISOString(),
        failureCategory: "execution_error",
        safeErrorMessage: "boom again",
      }, {
        type: "run_failed",
        level: "error",
        message: "boom again",
      }),
    ]);

    assert.equal(attempts.filter((attempt) => attempt?.transitioned).length, 1);
    const events = await store.listEvents(job.id);
    assert.equal(events.filter((event) => event.type === "run_failed").length, 1);
  });

  it("completed, failed, and cancelled jobs reject duplicate terminal transitions", async () => {
    for (const status of ["completed", "failed", "cancelled"] as const) {
      resetMemoryDiscoveryJobStoreForTests();
      const store = createMemoryDiscoveryJobStore();
      setDiscoveryJobStoreForTests(store);
      const job = await store.createJob({ command: `find ${status}`, dryRun: true });
      const first = await store.transitionToTerminal(job.id, {
        status,
        progress: 100,
        currentStage: status,
        completedAt: new Date().toISOString(),
        ...(status === "cancelled" ? { cancelledAt: new Date().toISOString() } : {}),
      }, {
        type:
          status === "completed"
            ? "run_completed"
            : status === "cancelled"
              ? "run_cancelled"
              : "run_failed",
        level: status === "completed" ? "success" : status === "cancelled" ? "warning" : "error",
        message: status,
      });
      const second = await store.transitionToTerminal(job.id, {
        status,
        progress: 100,
        currentStage: status,
        completedAt: new Date().toISOString(),
      }, {
        type:
          status === "completed"
            ? "run_completed"
            : status === "cancelled"
              ? "run_cancelled"
              : "run_failed",
        level: status === "completed" ? "success" : status === "cancelled" ? "warning" : "error",
        message: `${status} duplicate`,
      });

      assert.equal(first?.transitioned, true);
      assert.equal(second?.transitioned, false);
      assert.equal((await store.listEvents(job.id)).length, 1);
    }
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
