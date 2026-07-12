import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatJobEventLine,
  formatJobSummary,
  normalizeJobEvent,
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
        durationMs: 12000,
        llmCalls: 3,
        fallbackUsed: false,
        sourceCounts: { mlh: 25, web: 25 },
      },
    };
    const text = formatJobSummary(job);
    assert.match(text, /created\s+7/);
    assert.match(text, /raw leads\s+77/);
    assert.match(text, /mlh:25/);
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
