import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import { awaitCollectorResultsWithTotalBudget } from "@/discovery/pipeline";

type TimerState = {
  activeCount: () => number;
  firedCount: () => number;
  restore: () => void;
};

function instrumentTimers(): TimerState {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const active = new Set<ReturnType<typeof setTimeout>>();
  let fired = 0;

  globalThis.setTimeout = ((
    handler: Parameters<typeof setTimeout>[0],
    timeout?: Parameters<typeof setTimeout>[1],
    ...args: unknown[]
  ) => {
    const wrapped = (...callbackArgs: unknown[]) => {
      fired += 1;
      active.delete(handle);
      if (typeof handler === "function") {
        (handler as (...args: unknown[]) => void)(...callbackArgs);
      }
    };

    const handle = originalSetTimeout(wrapped, timeout, ...args);
    active.add(handle);
    return handle;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((handle?: Parameters<typeof clearTimeout>[0]) => {
    if (handle !== undefined) {
      active.delete(handle as ReturnType<typeof setTimeout>);
    }
    return originalClearTimeout(handle);
  }) as typeof clearTimeout;

  return {
    activeCount: () => active.size,
    firedCount: () => fired,
    restore: () => {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("awaitCollectorResultsWithTotalBudget", () => {
  it("returns collector results and clears the total timeout when collectors finish first", async () => {
    const timers = instrumentTimers();
    try {
      const result = await awaitCollectorResultsWithTotalBudget(
        Promise.resolve(["lead"]),
        1_000,
      );

      assert.deepEqual(result, { result: ["lead"], timedOut: false });
      assert.equal(timers.firedCount(), 0);
      assert.equal(timers.activeCount(), 0);
    } finally {
      timers.restore();
    }
  });

  it("preserves collector rejection behavior and clears the total timeout", async () => {
    const timers = instrumentTimers();
    const collectorError = new Error("collector failed");

    try {
      await assert.rejects(
        awaitCollectorResultsWithTotalBudget(
          Promise.reject(collectorError),
          1_000,
        ),
        collectorError,
      );

      assert.equal(timers.firedCount(), 0);
      assert.equal(timers.activeCount(), 0);
    } finally {
      timers.restore();
    }
  });

  it("preserves timeout-win behavior and still clears the total timeout", async () => {
    const timers = instrumentTimers();
    try {
      const result = await awaitCollectorResultsWithTotalBudget(
        delay(20).then(() => ["late-lead"]),
        1,
      );

      assert.deepEqual(result, { result: ["late-lead"], timedOut: true });
      assert.equal(timers.activeCount(), 0);
    } finally {
      timers.restore();
    }
  });

  it("preserves partial collector results and clears the total timeout", async () => {
    const timers = instrumentTimers();
    const partialResults = [
      {
        source: "devpost",
        outcome: "degraded",
        leads: [{ title: "Partial lead" }],
        warnings: ["detail fetch timed out"],
      },
    ];

    try {
      const result = await awaitCollectorResultsWithTotalBudget(
        Promise.resolve(partialResults),
        1_000,
      );

      assert.deepEqual(result, { result: partialResults, timedOut: false });
      assert.equal(timers.firedCount(), 0);
      assert.equal(timers.activeCount(), 0);
    } finally {
      timers.restore();
    }
  });

  it("does not accumulate timers across sequential runs", async () => {
    const timers = instrumentTimers();
    try {
      for (let index = 0; index < 5; index += 1) {
        const result = await awaitCollectorResultsWithTotalBudget(
          Promise.resolve([index]),
          1_000,
        );

        assert.deepEqual(result, { result: [index], timedOut: false });
        assert.equal(timers.activeCount(), 0);
      }

      assert.equal(timers.firedCount(), 0);
    } finally {
      timers.restore();
    }
  });

  it("lets a fast collector path exit promptly without waiting for the total budget", () => {
    const script = `
      const mod = await import("./src/discovery/pipeline.ts");
      const awaitCollectorResultsWithTotalBudget =
        mod.awaitCollectorResultsWithTotalBudget ?? mod.default?.awaitCollectorResultsWithTotalBudget;
      const result = await awaitCollectorResultsWithTotalBudget(Promise.resolve(["ok"]), 5_000);
      if (result.timedOut || result.result[0] !== "ok") process.exit(1);
      console.log("done");
    `;

    const child = spawnSync(process.execPath, ["--import", "tsx", "-e", script], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 3_000,
    });

    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /done/);
  });
});
