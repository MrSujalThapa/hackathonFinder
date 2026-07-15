import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { emptyCollectorResult } from "@/collectors/types";
import {
  acquireSourceLock,
  collectWithSourceLocks,
  hakkuProfileLockKey,
  resetSourceLocksForTests,
  SourceLockCancelledError,
  SourceLockTimeoutError,
  sourceLockKey,
  sourceLockMax,
  withSourceLock,
} from "@/discovery/sourceLocks";
import type { DiscoveryEvent } from "@/discovery/events";

describe("source locks", () => {
  afterEach(() => {
    resetSourceLocksForTests();
    delete process.env.DISCOVERY_PUBLIC_SOURCE_CONCURRENCY;
    delete process.env.DISCOVERY_SOURCE_LOCK_WAIT_MS;
    delete process.env.HAKKU_PROFILE_NAME;
  });

  it("serializes Hakku profile lock to one holder", async () => {
    process.env.HAKKU_PROFILE_NAME = "hakku-test";
    resetSourceLocksForTests();

    assert.equal(sourceLockMax("hakku"), 1);
    assert.equal(sourceLockKey("hakku"), hakkuProfileLockKey());

    const order: string[] = [];
    let releaseFirst!: () => void;

    const first = withSourceLock("hakku", async () => {
      order.push("first-enter");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push("first-exit");
    });

    await new Promise((r) => setTimeout(r, 10));

    let secondStarted = false;
    const second = withSourceLock("hakku", async () => {
      secondStarted = true;
      order.push("second");
    });

    await new Promise((r) => setTimeout(r, 20));
    assert.equal(secondStarted, false);

    releaseFirst();
    await first;
    await second;
    assert.deepEqual(order, ["first-enter", "first-exit", "second"]);
  });

  it("bounds public source concurrency", async () => {
    process.env.DISCOVERY_PUBLIC_SOURCE_CONCURRENCY = "2";
    resetSourceLocksForTests();

    let inFlight = 0;
    let peak = 0;
    const run = (source: "mlh" | "web" | "devpost") =>
      withSourceLock(source, async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 30));
        inFlight -= 1;
      });

    await Promise.all([run("mlh"), run("web"), run("devpost")]);
    assert.equal(peak, 2);
  });

  it("cancel while waiting releases the waiter", async () => {
    const abort = new AbortController();
    const hold = await acquireSourceLock({ source: "hakku" });

    const waiting = acquireSourceLock({
      source: "hakku",
      signal: abort.signal,
      timeoutMs: 5_000,
    });

    await new Promise((r) => setTimeout(r, 10));
    abort.abort();

    await assert.rejects(waiting, SourceLockCancelledError);
    hold();
  });

  it("lock timeout degrades one source without failing siblings", async () => {
    process.env.DISCOVERY_SOURCE_LOCK_WAIT_MS = "40";
    resetSourceLocksForTests();

    const events: DiscoveryEvent["type"][] = [];
    const hold = await acquireSourceLock({ source: "hakku" });

    const results = await collectWithSourceLocks(
      ["hakku", "mlh"],
      async (source) => {
        const result = emptyCollectorResult(source);
        result.durationMs = 1;
        if (source === "mlh") {
          result.warnings.push("ok");
        }
        return result;
      },
      {
        lockWaitTimeoutMs: 40,
        publicConcurrency: 3,
        eventSink: {
          emit(event) {
            events.push(event.type as DiscoveryEvent["type"]);
          },
        },
      },
    );

    hold();

    const hakku = results.find((r) => r.source === "hakku");
    const mlh = results.find((r) => r.source === "mlh");
    assert.ok(hakku);
    assert.ok(mlh);
    assert.ok(hakku.errors.some((e) => /Timed out/i.test(e)));
    assert.deepEqual(mlh.errors, []);
    assert.ok(events.includes("source_degraded"));
    assert.ok(events.includes("source_progress"));
  });

  it("throws SourceLockTimeoutError from acquireSourceLock", async () => {
    const hold = await acquireSourceLock({ source: "hakku" });
    await assert.rejects(
      () =>
        acquireSourceLock({
          source: "hakku",
          timeoutMs: 25,
        }),
      SourceLockTimeoutError,
    );
    hold();
  });
});
