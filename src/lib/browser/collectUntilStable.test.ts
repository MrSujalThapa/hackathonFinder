import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectUntilStable } from "@/lib/browser/collectUntilStable";

async function collectFromBatches(
  batches: string[][],
  options: Partial<{
    maxItems: number;
    maxScrolls: number;
    noGrowthLimit: number;
    timeoutMs: number;
  }> = {},
) {
  let index = 0;
  let scrolls = 0;
  return collectUntilStable<string>({
    collectItems: async () => batches[Math.min(index, batches.length - 1)] ?? [],
    getKey: (item) => item,
    scroll: async () => {
      scrolls += 1;
      index = Math.min(index + 1, batches.length - 1);
    },
    maxItems: options.maxItems ?? 100,
    maxScrolls: options.maxScrolls ?? 30,
    noGrowthLimit: options.noGrowthLimit ?? 3,
    timeoutMs: options.timeoutMs ?? 5_000,
    waitMs: 0,
    logger: () => undefined,
  }).then((result) => ({ ...result, scrolls }));
}

describe("collectUntilStable", () => {
  it("handles an initial batch only", async () => {
    const result = await collectFromBatches([["a", "b"], ["a", "b"]]);
    assert.deepEqual(result.items, ["a", "b"]);
    assert.equal(result.stopReason, "no_growth");
    assert.equal(result.noGrowthAttempts, 3);
  });

  it("appends multiple lazy-loaded batches", async () => {
    const result = await collectFromBatches([
      ["a", "b"],
      ["a", "b", "c"],
      ["a", "b", "c", "d"],
      ["a", "b", "c", "d"],
    ]);
    assert.deepEqual(result.items, ["a", "b", "c", "d"]);
    assert.deepEqual(result.growthByAttempt.slice(0, 2), [1, 1]);
  });

  it("stops at the item cap", async () => {
    const result = await collectFromBatches([["a"], ["a", "b", "c"], ["a", "b", "c", "d"]], {
      maxItems: 3,
    });
    assert.equal(result.uniqueCount, 3);
    assert.equal(result.stopReason, "max_items");
  });

  it("stops at the scroll cap", async () => {
    const result = await collectFromBatches([["a"], ["a", "b"], ["a", "b", "c"]], {
      maxScrolls: 2,
      noGrowthLimit: 10,
    });
    assert.equal(result.scrollAttempts, 2);
    assert.equal(result.stopReason, "max_scrolls");
  });

  it("stops after three no-growth attempts", async () => {
    const result = await collectFromBatches([["a"], ["a"], ["a"], ["a"]], {
      noGrowthLimit: 3,
    });
    assert.equal(result.stopReason, "no_growth");
    assert.equal(result.noGrowthAttempts, 3);
  });

  it("deduplicates reordered cards across batches", async () => {
    const result = await collectFromBatches([
      ["a", "b", "c"],
      ["c", "b", "a", "d"],
      ["d", "a", "c", "b"],
    ]);
    assert.deepEqual(result.items, ["a", "b", "c", "d"]);
  });
});
