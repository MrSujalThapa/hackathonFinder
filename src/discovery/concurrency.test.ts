import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  assertJobQueueAdmission,
  DiscoveryJobQueueFullError,
  getDiscoveryJobConcurrencyGate,
  isDiscoveryJobCancelledWhileQueuedError,
  resetDiscoveryJobConcurrencyGateForTests,
} from "@/discovery/concurrency";

describe("discovery job concurrency gate", () => {
  afterEach(() => {
    resetDiscoveryJobConcurrencyGateForTests();
    delete process.env.DISCOVERY_MAX_ACTIVE_JOBS;
    delete process.env.DISCOVERY_MAX_QUEUED_JOBS;
  });

  it("runs up to max active jobs and queues the rest", async () => {
    process.env.DISCOVERY_MAX_ACTIVE_JOBS = "2";
    process.env.DISCOVERY_MAX_QUEUED_JOBS = "10";
    resetDiscoveryJobConcurrencyGateForTests();
    const gate = getDiscoveryJobConcurrencyGate();

    let releaseA!: () => void;
    let releaseB!: () => void;
    const started: string[] = [];
    const positions: Record<string, number[]> = { c: [] };

    const hold = (id: string, assign: (release: () => void) => void) =>
      gate.run({ jobId: id }, async () => {
        started.push(id);
        await new Promise<void>((resolve) => {
          assign(() => resolve());
        });
      });

    const pA = hold("a", (r) => {
      releaseA = r;
    });
    const pB = hold("b", (r) => {
      releaseB = r;
    });

    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(started.sort(), ["a", "b"]);
    assert.equal(gate.activeCount, 2);

    const pC = gate.run(
      {
        jobId: "c",
        onPosition: (pos) => {
          positions.c.push(pos);
        },
      },
      async () => {
        started.push("c");
      },
    );

    await new Promise((r) => setTimeout(r, 20));
    assert.equal(gate.waitingCount, 1);
    assert.ok(positions.c.includes(1));
    assert.ok(!started.includes("c"));

    releaseA();
    await pA;
    await pC;
    assert.ok(started.includes("c"));
    assert.ok(positions.c.includes(0));

    releaseB();
    await pB;
    assert.equal(gate.activeCount, 0);
    assert.equal(gate.waitingCount, 0);
  });

  it("rejects when the wait queue is full", async () => {
    process.env.DISCOVERY_MAX_ACTIVE_JOBS = "1";
    process.env.DISCOVERY_MAX_QUEUED_JOBS = "1";
    resetDiscoveryJobConcurrencyGateForTests();
    const gate = getDiscoveryJobConcurrencyGate();

    let release!: () => void;
    const holder = gate.run({ jobId: "holder" }, async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });

    await new Promise((r) => setTimeout(r, 10));

    const waiter = gate.run({ jobId: "waiter" }, async () => undefined);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(gate.waitingCount, 1);

    await assert.rejects(
      () => gate.run({ jobId: "overflow" }, async () => undefined),
      (error: unknown) => {
        assert.ok(error instanceof DiscoveryJobQueueFullError);
        return true;
      },
    );

    release();
    await holder;
    await waiter;
  });

  it("cancel while waiting releases the slot without running", async () => {
    process.env.DISCOVERY_MAX_ACTIVE_JOBS = "1";
    process.env.DISCOVERY_MAX_QUEUED_JOBS = "5";
    resetDiscoveryJobConcurrencyGateForTests();
    const gate = getDiscoveryJobConcurrencyGate();

    let release!: () => void;
    let ranWaiting = false;
    const holder = gate.run({ jobId: "holder" }, async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });

    await new Promise((r) => setTimeout(r, 10));

    const waiting = gate.run({ jobId: "waiting" }, async () => {
      ranWaiting = true;
    });

    await new Promise((r) => setTimeout(r, 10));
    assert.equal(gate.waitingCount, 1);
    assert.equal(gate.cancelWaiting("waiting"), true);

    await assert.rejects(waiting, (error: unknown) =>
      isDiscoveryJobCancelledWhileQueuedError(error),
    );
    assert.equal(ranWaiting, false);
    assert.equal(gate.waitingCount, 0);

    release();
    await holder;
  });

  it("assertJobQueueAdmission blocks at maxQueuedJobs", () => {
    assert.throws(
      () => assertJobQueueAdmission({ waiting: 10, maxQueuedJobs: 10 }),
      DiscoveryJobQueueFullError,
    );
    assert.doesNotThrow(() =>
      assertJobQueueAdmission({ waiting: 9, maxQueuedJobs: 10 }),
    );
  });
});
