import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolve } from "node:path";
import {
  IdentityAccumulator,
  clampProgressEvent,
  classifyUniqueCapStop,
  collectUntilStable,
  crawlDirectory,
  createProgressEvent,
  mapStableScrollStopReason,
  sourceStateForStopReason,
  type CrawlBudget,
  type DirectoryAdapter,
  type ListingCard,
} from "@/crawl";
import { collectUntilStable as collectUntilStableFromLib } from "@/lib/browser/collectUntilStable";

function card(id: string, title = id): ListingCard {
  return { identity: id, title };
}

function mockPagesAdapter(pages: ListingCard[][]): DirectoryAdapter<{ page: number }> {
  return {
    id: "mock-pages",
    version: "test-1",
    async acquire() {
      return {
        mechanism: "api",
        requestedUrl: "https://example.test/list",
        finalUrl: "https://example.test/list",
        session: { page: 0 },
      };
    },
    async grow({ session }) {
      const index = session.page;
      session.page += 1;
      const cards = pages[index] ?? [];
      const done = index >= pages.length - 1;
      const grew = cards.length > 0 && index < pages.length;
      return {
        cards,
        requestsUsed: 1,
        pagesOrScrollsUsed: 1,
        actionsUsed: 0,
        grew: index === 0 ? cards.length > 0 : grew,
        duplicateRate: 0,
        done: done && cards.length === 0 ? true : done && index >= pages.length - 1 && pages[index]?.length === 0,
        stopHint: cards.length === 0 && index > 0 ? "no_growth" : undefined,
      };
    },
    async release() {
      /* no-op */
    },
  };
}

function sequentialAdapter(pages: ListingCard[][]): DirectoryAdapter<{ page: number; released: boolean }> {
  return {
    id: "sequential",
    version: "test-1",
    async acquire() {
      return {
        mechanism: "api",
        requestedUrl: "https://example.test/",
        finalUrl: "https://example.test/",
        session: { page: 0, released: false },
      };
    },
    async grow({ session, seen }) {
      if (session.page >= pages.length) {
        return {
          cards: [],
          requestsUsed: 0,
          pagesOrScrollsUsed: 0,
          actionsUsed: 0,
          grew: false,
          duplicateRate: 0,
          done: true,
        };
      }
      const cards = pages[session.page] ?? [];
      session.page += 1;
      const novel = cards.filter((c) => !seen.has(c.identity));
      return {
        cards,
        requestsUsed: 1,
        pagesOrScrollsUsed: 1,
        actionsUsed: 0,
        grew: novel.length > 0,
        duplicateRate: cards.length ? (cards.length - novel.length) / cards.length : 0,
        done: session.page >= pages.length,
      };
    },
    async release(session) {
      session.released = true;
    },
  };
}

const baseBudget = (overrides: Partial<CrawlBudget> = {}): CrawlBudget => ({
  maxDurationMs: 5_000,
  maxRequests: 50,
  maxPagesOrScrolls: 20,
  maxBrowserActions: 50,
  maxPayloadBytes: 1_000_000,
  ...overrides,
});

describe("crawl kernel", () => {
  it("distinguishes target_reached from maximum_cards_reached", async () => {
    const pages = [
      [card("a"), card("b"), card("c")],
      [card("d"), card("e"), card("f")],
      [card("g"), card("h")],
    ];
    const target = await crawlDirectory({
      adapter: sequentialAdapter(pages),
      url: "https://example.test/",
      budget: baseBudget({ targetUnique: 4, maxUnique: 8, stopAtTarget: true }),
    });
    assert.equal(target.stopReason, "target_reached");
    assert.equal(target.targetReached, true);
    assert.ok(target.cards.length >= 4);
    assert.equal(sourceStateForStopReason(target.stopReason), "healthy_bounded");

    const capped = await crawlDirectory({
      adapter: sequentialAdapter(pages),
      url: "https://example.test/",
      budget: baseBudget({ maxUnique: 5, stopAtTarget: false }),
    });
    assert.equal(capped.stopReason, "maximum_cards_reached");
    assert.equal(capped.cards.length, 5);
  });

  it("stops on no_growth and exhausted", async () => {
    const noGrowth = await crawlDirectory({
      adapter: sequentialAdapter([[card("a")], [card("a")], []]),
      url: "https://example.test/",
      budget: baseBudget(),
    });
    assert.ok(["no_growth", "exhausted"].includes(noGrowth.stopReason));

    const exhausted = await crawlDirectory({
      adapter: {
        id: "done",
        version: "1",
        async acquire() {
          return {
            mechanism: "api" as const,
            requestedUrl: "u",
            finalUrl: "u",
            session: {},
          };
        },
        async grow() {
          return {
            cards: [card("x")],
            requestsUsed: 1,
            pagesOrScrollsUsed: 1,
            actionsUsed: 0,
            grew: true,
            duplicateRate: 0,
            done: true,
          };
        },
      },
      url: "u",
      budget: baseBudget(),
    });
    assert.equal(exhausted.stopReason, "exhausted");
  });

  it("honors timeout and cancellation", async () => {
    const timed = await crawlDirectory({
      adapter: {
        id: "slow",
        version: "1",
        async acquire() {
          return { mechanism: "scroll" as const, requestedUrl: "u", finalUrl: "u", session: { n: 0 } };
        },
        async grow({ session }) {
          await new Promise((r) => setTimeout(r, 30));
          session.n += 1;
          return {
            cards: [card(`i-${session.n}`)],
            requestsUsed: 1,
            pagesOrScrollsUsed: 1,
            actionsUsed: 1,
            grew: true,
            duplicateRate: 0,
            done: false,
          };
        },
      },
      url: "u",
      budget: baseBudget({ maxDurationMs: 40, maxPagesOrScrolls: 100 }),
    });
    assert.equal(timed.stopReason, "timeout");

    const controller = new AbortController();
    const pending = crawlDirectory({
      adapter: {
        id: "cancel",
        version: "1",
        async acquire() {
          return { mechanism: "api" as const, requestedUrl: "u", finalUrl: "u", session: {} };
        },
        async grow() {
          controller.abort();
          await new Promise((r) => setTimeout(r, 5));
          return {
            cards: [card("z")],
            requestsUsed: 1,
            pagesOrScrollsUsed: 1,
            actionsUsed: 0,
            grew: true,
            duplicateRate: 0,
            done: false,
          };
        },
      },
      url: "u",
      budget: baseBudget(),
      signal: controller.signal,
    });
    const cancelled = await pending;
    assert.equal(cancelled.stopReason, "cancelled");
    assert.equal(cancelled.cancelled, true);
  });

  it("tracks duplicates and releases sessions on success and failure", async () => {
    const acc = new IdentityAccumulator();
    const first = acc.merge([card("a"), card("b")]);
    const second = acc.merge([card("b"), card("c")]);
    assert.equal(first.added, 2);
    assert.equal(second.added, 1);
    assert.equal(second.duplicates, 1);
    assert.equal(acc.size, 3);

    const session = { page: 0, released: false };
    const adapter: DirectoryAdapter<typeof session> = {
      id: "release",
      version: "1",
      async acquire() {
        return { mechanism: "api", requestedUrl: "u", finalUrl: "u", session };
      },
      async grow() {
        throw new Error("boom");
      },
      async release(s) {
        s.released = true;
      },
    };
    const failed = await crawlDirectory({ adapter, url: "u", budget: baseBudget() });
    assert.equal(failed.stopReason, "acquisition_failed");
    assert.equal(session.released, true);
  });

  it("emits bounded progress events and ignores relevance fields", async () => {
    const events: ReturnType<typeof createProgressEvent>[] = [];
    await crawlDirectory({
      adapter: sequentialAdapter([[card("a")], [card("b")]]),
      url: "https://example.test/",
      budget: baseBudget({ maxUnique: 2 }),
      onProgress: (event) => events.push(event),
    });
    assert.ok(events.some((e) => e.type === "acquired"));
    assert.ok(events.some((e) => e.type === "grew" || e.type === "stopped"));
    const clamped = clampProgressEvent({
      type: "stopped",
      unique: 1,
      pagesOrScrolls: 1,
      stopReason: "no_growth",
    });
    assert.ok(Buffer.byteLength(JSON.stringify(clamped), "utf8") <= 512);

    // Kernel module must not import discovery relevance / collectors.
    const kernelSource = readFileSync(resolve("src/crawl/kernel.ts"), "utf8");
    assert.equal(/themeRelevant|queryRelevant|devpost|luma|@\/discovery|@\/collectors/.test(kernelSource), false);
  });

  it("maps stable scroll stop reasons without renaming production strings", () => {
    assert.equal(mapStableScrollStopReason("max_items", { stopAtTarget: true }), "target_reached");
    assert.equal(mapStableScrollStopReason("max_items", { stopAtTarget: false }), "maximum_cards_reached");
    assert.equal(mapStableScrollStopReason("no_growth"), "no_growth");
    assert.equal(classifyUniqueCapStop({ unique: 75, targetUnique: 75, stopAtTarget: true }), "target_reached");
    assert.equal(classifyUniqueCapStop({ unique: 500, maxUnique: 500 }), "maximum_cards_reached");
  });
});

describe("collectUntilStable parity", () => {
  it("lib re-export is the crawl growth implementation", () => {
    assert.equal(collectUntilStable, collectUntilStableFromLib);
  });

  it("preserves dedupe and stop semantics", async () => {
    let index = 0;
    const batches = [["a", "b"], ["a", "b", "c"], ["a", "b", "c"]];
    const result = await collectUntilStable({
      collectItems: async () => batches[Math.min(index, batches.length - 1)] ?? [],
      getKey: (item) => item,
      scroll: async () => {
        index = Math.min(index + 1, batches.length - 1);
      },
      maxItems: 100,
      maxScrolls: 10,
      noGrowthLimit: 2,
      timeoutMs: 5_000,
      waitMs: 0,
    });
    assert.deepEqual(result.items, ["a", "b", "c"]);
    assert.equal(result.stopReason, "no_growth");
  });
});

// silence unused in case tree-shake
void mockPagesAdapter;
