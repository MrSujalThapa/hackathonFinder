import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IdentityAccumulator } from "@/crawl/identityAccumulator";
import type { ListingCard } from "@/crawl/types";
import { crawlDirectory } from "@/crawl/kernel";
import type { DirectoryAdapter, GrowthStepResult } from "@/crawl/types";

describe("B2 kernel growth contracts (scroll / next / static)", () => {
  it("static mechanism exhausts after initial page", async () => {
    const cards: ListingCard[] = [
      { identity: "a", title: "Event A", url: "https://example.com/a" },
      { identity: "b", title: "Event B", url: "https://example.com/b" },
    ];
    type Session = { emitted: boolean };
    const adapter: DirectoryAdapter<Session> = {
      id: "static-fixture",
      version: "test",
      async acquire() {
        return {
          mechanism: "static",
          requestedUrl: "https://example.com/",
          finalUrl: "https://example.com/",
          session: { emitted: false },
        };
      },
      async grow({ session }): Promise<GrowthStepResult> {
        if (!session.emitted) {
          session.emitted = true;
          return {
            cards,
            requestsUsed: 1,
            pagesOrScrollsUsed: 1,
            actionsUsed: 0,
            grew: true,
            duplicateRate: 0,
            done: false,
          };
        }
        return {
          cards: [],
          requestsUsed: 0,
          pagesOrScrollsUsed: 0,
          actionsUsed: 0,
          grew: false,
          duplicateRate: 0,
          done: true,
        };
      },
    };
    const result = await crawlDirectory({
      adapter,
      url: "https://example.com/",
      budget: {
        maxDurationMs: 5_000,
        maxRequests: 5,
        maxPagesOrScrolls: 5,
        maxBrowserActions: 5,
        maxPayloadBytes: 1_000_000,
      },
    });
    assert.equal(result.mechanism, "static");
    assert.equal(result.cards.length, 2);
    assert.ok(result.stopReason === "exhausted" || result.stopReason === "no_growth");
  });

  it("next growth accumulates unique identities across steps", async () => {
    type Session = { step: number };
    const adapter: DirectoryAdapter<Session> = {
      id: "next-fixture",
      version: "test",
      async acquire() {
        return {
          mechanism: "next",
          requestedUrl: "https://example.com/",
          finalUrl: "https://example.com/",
          session: { step: 0 },
        };
      },
      async grow({ session }): Promise<GrowthStepResult> {
        session.step += 1;
        if (session.step === 1) {
          return {
            cards: [
              { identity: "1", title: "One" },
              { identity: "2", title: "Two" },
            ],
            requestsUsed: 1,
            pagesOrScrollsUsed: 1,
            actionsUsed: 1,
            grew: true,
            duplicateRate: 0,
            done: false,
          };
        }
        if (session.step === 2) {
          return {
            cards: [
              { identity: "2", title: "Two" },
              { identity: "3", title: "Three" },
            ],
            requestsUsed: 1,
            pagesOrScrollsUsed: 1,
            actionsUsed: 1,
            grew: true,
            duplicateRate: 0.5,
            done: false,
          };
        }
        return {
          cards: [],
          requestsUsed: 0,
          pagesOrScrollsUsed: 0,
          actionsUsed: 0,
          grew: false,
          duplicateRate: 0,
          done: true,
        };
      },
    };
    const result = await crawlDirectory({
      adapter,
      url: "https://example.com/",
      budget: {
        maxDurationMs: 5_000,
        maxRequests: 10,
        maxPagesOrScrolls: 5,
        maxBrowserActions: 5,
        maxPayloadBytes: 1_000_000,
      },
    });
    assert.equal(result.mechanism, "next");
    assert.equal(result.cards.length, 3);
    assert.equal(result.pagesOrScrolls >= 2, true);
  });

  it("scroll growth stops on repeated no-growth", async () => {
    type Session = { step: number };
    const adapter: DirectoryAdapter<Session> = {
      id: "scroll-fixture",
      version: "test",
      async acquire() {
        return {
          mechanism: "scroll",
          requestedUrl: "https://example.com/",
          finalUrl: "https://example.com/",
          session: { step: 0 },
        };
      },
      async grow({ session }): Promise<GrowthStepResult> {
        session.step += 1;
        if (session.step === 1) {
          return {
            cards: [{ identity: "s1", title: "Scroll One" }],
            requestsUsed: 1,
            pagesOrScrollsUsed: 1,
            actionsUsed: 1,
            grew: true,
            duplicateRate: 0,
            done: false,
          };
        }
        return {
          cards: [{ identity: "s1", title: "Scroll One" }],
          requestsUsed: 1,
          pagesOrScrollsUsed: 1,
          actionsUsed: 1,
          grew: false,
          duplicateRate: 1,
          done: false,
        };
      },
    };
    const result = await crawlDirectory({
      adapter,
      url: "https://example.com/",
      budget: {
        maxDurationMs: 5_000,
        maxRequests: 10,
        maxPagesOrScrolls: 10,
        maxBrowserActions: 10,
        maxPayloadBytes: 1_000_000,
      },
    });
    assert.equal(result.mechanism, "scroll");
    assert.equal(result.cards.length, 1);
    assert.equal(result.stopReason, "no_growth");
  });

  it("stable identity accumulator dedupes", () => {
    const acc = new IdentityAccumulator();
    const merge1 = acc.merge([
      { identity: "x", title: "X" },
      { identity: "y", title: "Y" },
    ]);
    const merge2 = acc.merge([
      { identity: "y", title: "Y" },
      { identity: "z", title: "Z" },
    ]);
    assert.equal(merge1.added, 2);
    assert.equal(merge2.added, 1);
    assert.equal(acc.size, 3);
  });
});
