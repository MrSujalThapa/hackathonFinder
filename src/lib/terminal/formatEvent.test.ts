import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatJobEventLine,
  formatJobSummary,
  normalizeJobEvent,
  shouldSuppressTerminalEvent,
} from "@/lib/terminal/formatEvent";
import type { DiscoveryJob, DiscoveryJobEvent } from "@/lib/terminal/types";

describe("formatJobEventLine", () => {
  it("prefixes source when present", () => {
    const event: DiscoveryJobEvent = {
      id: "e1",
      jobId: "j1",
      sequence: 1,
      timestamp: "2026-07-12T00:00:00.000Z",
      type: "source_progress",
      level: "info",
      source: "mlh",
      message: "25 leads found",
    };
    assert.equal(formatJobEventLine(event), "[mlh] 25 leads found");
  });

  it("uses short type when source missing", () => {
    const event: DiscoveryJobEvent = {
      id: "e2",
      jobId: "j1",
      sequence: 2,
      timestamp: "2026-07-12T00:00:00.000Z",
      type: "planning_started",
      level: "info",
      message: "Interpreting request…",
    };
    assert.match(formatJobEventLine(event), /Interpreting/);
  });
});

describe("formatJobSummary", () => {
  it("includes counts from job fields", () => {
    const job: DiscoveryJob = {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      command: "find AI in Toronto",
      status: "completed",
      createdAt: "2026-07-12T00:00:00.000Z",
      createdCount: 7,
      updatedCount: 36,
      acceptedCount: 43,
      rejectedCount: 10,
      needsReviewCount: 2,
      summary: {
        rawLeads: 77,
        uniqueLeads: 43,
        queueReady: 41,
        durationMs: 12000,
        llmCalls: 3,
        fallbackUsed: false,
        sourceCounts: { mlh: 25, web: 25 },
      },
    };
    const text = formatJobSummary(job);
    assert.match(text, /created\s+7/);
    assert.match(text, /raw collected\s+77/);
    assert.match(text, /queue-ready\s+41/);
    assert.match(text, /needs review\s+2/);
    assert.match(text, /mlh:25/);
  });

  it("labels dry-run persistence projections as would create/update", () => {
    const job: DiscoveryJob = {
      id: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      command: "find AI --dry-run",
      status: "completed",
      createdAt: "2026-07-12T00:00:00.000Z",
      createdCount: 16,
      updatedCount: 0,
      acceptedCount: 16,
      rejectedCount: 10,
      needsReviewCount: 15,
      summary: {
        dryRun: true,
        queueReady: 1,
        rawLeads: 100,
        uniqueLeads: 80,
      },
    };
    const text = formatJobSummary(job);
    assert.match(text, /dry-run\s+yes/);
    assert.match(text, /would create\s+16/);
    assert.match(text, /would update\s+0/);
    assert.doesNotMatch(text, /^\s+created\s+/m);
  });

  it("suppresses fingerprint dumps unless verbose", () => {
    const event: DiscoveryJobEvent = {
      id: "e3",
      jobId: "j1",
      sequence: 3,
      timestamp: "2026-07-12T00:00:00.000Z",
      type: "source_progress",
      level: "warning",
      message: "page fingerprint warning dump",
    };
    assert.equal(shouldSuppressTerminalEvent(event, false), true);
  });
});

describe("normalizeJobEvent", () => {
  it("accepts runId alias and rejects incomplete payloads", () => {
    const ok = normalizeJobEvent(
      {
        id: "ev-1",
        runId: "job-9",
        sequence: 3,
        message: "ok",
        level: "warning",
        type: "source_auth_required",
      },
      "fallback",
    );
    assert.ok(ok);
    assert.equal(ok?.jobId, "job-9");
    assert.equal(ok?.level, "warning");

    const bad = normalizeJobEvent({ sequence: 1 }, "fallback");
    assert.equal(bad, null);
  });
});
