import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createProgressCoalescer } from "@/discovery/progressCoalescer";
import { stageBudgetForProfile, compactStageBudget } from "@/discovery/stageBudgets";
import { DISCOVERY_EVENT_TYPES } from "@/discovery/events";
import { compactJobForPoll } from "@/jobs/compactJob";
import type { DiscoveryJob } from "@/jobs/types";

describe("C2 progress coalescer", () => {
  it("coalesces noisy messages but never drops force-flush completions", async () => {
    const emitted: string[] = [];
    let clock = 1_000;
    const coalescer = createProgressCoalescer({
      minIntervalMs: 1_000,
      countThreshold: 100,
      now: () => clock,
      emit: async (message) => {
        emitted.push(message);
      },
    });

    // First note emits promptly (time-to-first-update).
    coalescer.note("1 unique events found");
    await coalescer.flush();
    assert.equal(emitted[0], "1 unique events found");

    clock = 1_100;
    coalescer.note("2 unique events found");
    coalescer.note("3 unique events found");
    // Still inside interval — held as pending.
    assert.equal(emitted.length, 1);

    clock = 2_200;
    coalescer.note("4 unique events found");
    await coalescer.flush();
    assert.equal(emitted.at(-1), "4 unique events found");

    coalescer.note("5 unique events found");
    coalescer.note("42 leads found");
    await coalescer.flushForce();
    assert.ok(emitted.includes("42 leads found"));
    const stats = coalescer.stats();
    assert.ok(stats.rawCallbacks > stats.emitted);
    assert.ok(stats.coalesced >= 1);
  });

  it("emits immediately on blocked/failure phrases", async () => {
    const emitted: string[] = [];
    const coalescer = createProgressCoalescer({
      minIntervalMs: 60_000,
      countThreshold: 1000,
      emit: async (message) => {
        emitted.push(message);
      },
    });
    coalescer.note("blocked_human_verification — stopping");
    await coalescer.flush();
    assert.equal(emitted[0], "blocked_human_verification — stopping");
  });
});

describe("C2 stage budgets", () => {
  it("keeps listing ownership and scales enrichment softly by profile", () => {
    const light = stageBudgetForProfile("light");
    const deep = stageBudgetForProfile("deep");
    assert.equal(light.preferFastListing, true);
    assert.ok(deep.enrichmentMaxPages >= light.enrichmentMaxPages);
    assert.ok(deep.enrichmentTimeoutMs >= light.enrichmentTimeoutMs);
    assert.equal(typeof compactStageBudget(light).enrichmentConcurrency, "number");
  });
});

describe("C2 event vocabulary", () => {
  it("includes compact progressive and persistence completion types", () => {
    assert.ok(DISCOVERY_EVENT_TYPES.includes("query_interpreted"));
    assert.ok(DISCOVERY_EVENT_TYPES.includes("result_summary_updated"));
    assert.ok(DISCOVERY_EVENT_TYPES.includes("persistence_completed"));
  });
});

describe("C2 compact job poll projection", () => {
  it("projects counters without inventing status", () => {
    const job = {
      id: "job-1",
      command: "find",
      status: "completed",
      requestedSources: [],
      effectiveSources: [],
      mode: "deterministic",
      dryRun: true,
      allSources: false,
      maxAgentCalls: null,
      progress: 100,
      currentStage: "completed",
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: new Date().toISOString(),
      cancelledAt: null,
      failureCategory: null,
      safeErrorMessage: null,
      agentRunId: null,
      createdCount: 0,
      updatedCount: 0,
      acceptedCount: 2,
      rejectedCount: 1,
      needsReviewCount: 0,
      rawLeadsCount: 5,
      durationMs: 12,
      claimToken: null,
      claimedAt: null,
      claimExpiresAt: null,
      workerId: null,
      cancelRequested: false,
      summary: {
        dryRun: true,
        accepted: 2,
        queueReady: 2,
        acceptedCandidates: [{ name: "A" }, { name: "B" }],
        warnings: ["x"],
      },
    } as DiscoveryJob;

    const compact = compactJobForPoll(job);
    assert.equal(compact.dryRun, true);
    assert.equal(compact.status, "completed");
    assert.equal((compact.summary as { queueReady: number }).queueReady, 2);
    assert.equal(
      ((compact.summary as { acceptedCandidates: unknown[] }).acceptedCandidates).length,
      2,
    );
  });
});
