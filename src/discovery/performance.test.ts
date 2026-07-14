import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";

import { emptyCollectorResult } from "@/collectors/types";
import { runDiscovery } from "@/discovery/runDiscovery";
import {
  acquireSourceLock,
  collectWithSourceLocks,
  resetSourceLocksForTests,
} from "@/discovery/sourceLocks";
import {
  createDiscoveryPerformanceTracker,
  formatPerformanceSummary,
} from "@/discovery/performance";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("discovery performance observability", { concurrency: false }, () => {
  afterEach(() => {
    resetSourceLocksForTests();
    delete process.env.DISCOVERY_PUBLIC_SOURCE_CONCURRENCY;
    delete process.env.DISCOVERY_SOURCE_LOCK_WAIT_MS;
  });

  it("uses monotonic elapsed time for stages", async () => {
    const tracker = createDiscoveryPerformanceTracker();

    await tracker.measure("collection", () => delay(5));
    const summary = tracker.finalize();

    assert.equal(summary.stages[0]?.name, "collection");
    assert.ok((summary.collectionMs ?? 0) >= 1);
    assert.ok(summary.totalMs >= (summary.collectionMs ?? 0));
  });

  it("keeps concurrent collector wall time separate from overlapping collector durations", async () => {
    process.env.DISCOVERY_PUBLIC_SOURCE_CONCURRENCY = "2";
    resetSourceLocksForTests();
    const tracker = createDiscoveryPerformanceTracker();
    const startedAtMs = tracker.now();

    await collectWithSourceLocks(
      ["mock", "hacklist"],
      async (source) => {
        await delay(25);
        const result = emptyCollectorResult(source);
        result.leads = [
          {
            id: `${source}-lead`,
            source,
            title: `${source} lead`,
            links: [],
            postedAt: "2026-07-14T00:00:00Z",
          },
        ];
        result.diagnostics.discovered = 1;
        result.diagnostics.returned = 1;
        return result;
      },
      {
        publicConcurrency: 2,
        onCollectorTiming: (timing) => tracker.recordCollector(timing),
      },
    );
    tracker.recordStage("collection", startedAtMs, tracker.now());

    const summary = tracker.finalize();
    const collectorTotal = Object.values(summary.collectors).reduce(
      (total, item) => total + item.totalMs,
      0,
    );

    assert.equal(Object.keys(summary.collectors).length, 2);
    assert.ok((summary.collectionMs ?? 0) < collectorTotal);
  });

  it("separates source wait from collector execution", async () => {
    process.env.DISCOVERY_PUBLIC_SOURCE_CONCURRENCY = "1";
    resetSourceLocksForTests();
    const tracker = createDiscoveryPerformanceTracker();

    await collectWithSourceLocks(
      ["mock", "hacklist"],
      async (source) => {
        await delay(15);
        const result = emptyCollectorResult(source);
        result.diagnostics.discovered = 1;
        result.diagnostics.returned = 1;
        return result;
      },
      {
        publicConcurrency: 1,
        onCollectorTiming: (timing) => tracker.recordCollector(timing),
      },
    );

    const timings = Object.values(tracker.finalize().collectors);
    assert.equal(timings.length, 2);
    assert.ok(timings.some((timing) => timing.waitMs > 0));
    assert.ok(timings.every((timing) => timing.executionMs > 0));
  });

  it("successful dry-runs emit a timing summary without changing discovery results", async () => {
    const result = await runDiscovery({
      command: "find upcoming hackathons in toronto",
      mode: "deterministic",
      dryRun: true,
      sources: ["mock"],
      maxResults: 3,
    });

    assert.equal(result.summary.rawLeads, 3);
    assert.equal(result.summary.rejected, 0);
    assert.equal(result.summary.performance?.persistence?.skipped, true);
    assert.deepEqual(Object.keys(result.summary.performance?.collectors ?? {}), ["mock"]);
  });

  it("timed-out source-lock runs retain a timing summary where possible", async () => {
    process.env.DISCOVERY_PUBLIC_SOURCE_CONCURRENCY = "1";
    process.env.DISCOVERY_SOURCE_LOCK_WAIT_MS = "5";
    resetSourceLocksForTests();
    const release = await acquireSourceLock({ source: "mock" });

    try {
      const result = await runDiscovery({
        command: "find upcoming hackathons in toronto",
        mode: "deterministic",
        dryRun: true,
        sources: ["mock"],
        maxResults: 1,
      });

      assert.equal(result.summary.rawLeads, 0);
      assert.equal(result.summary.performance?.collectors.mock?.outcome, "timed out");
      assert.ok((result.summary.performance?.collectors.mock?.waitMs ?? 0) >= 1);
    } finally {
      release();
    }
  });

  it("formats aligned seconds and dry-run persistence state", () => {
    const lines = formatPerformanceSummary({
      stages: [],
      collectors: {
        mock: {
          source: "mock",
          waitMs: 0,
          executionMs: 1234,
          totalMs: 1234,
          rawLeadCount: 2,
          returnedLeadCount: 2,
          outcome: "completed",
        },
      },
      collectionMs: 1234,
      persistence: {
        skipped: true,
        totalMs: 0,
        candidateMs: 0,
        evidenceMs: 0,
        completionMs: 0,
        acceptedCandidates: 2,
        candidateLookups: 0,
        candidateInserts: 0,
        candidateUpdates: 0,
        candidateFailures: 0,
        evidenceLookups: 0,
        evidenceInserts: 0,
        evidenceUpdates: 0,
        evidenceFailures: 0,
        databaseCalls: 0,
      },
      totalMs: 1500,
    });

    assert.match(lines.join("\n"), /\[performance\] Run timing/);
    assert.match(lines.join("\n"), /collection\s+1\.2s/);
    assert.match(lines.join("\n"), /persistence\s+skipped \(dry run\)/);
  });

  it("does not place candidate content in timing metadata", async () => {
    const result = await runDiscovery({
      command: "find upcoming hackathons in toronto",
      mode: "deterministic",
      dryRun: true,
      sources: ["mock"],
      maxResults: 1,
    });

    const serialized = JSON.stringify(result.summary.performance);
    assert.doesNotMatch(serialized, /HackTO AI Challenge/);
    assert.doesNotMatch(serialized, /hackto\.example\.com/);
  });
});
