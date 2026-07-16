/**
 * C2 performance probe — records event counts/bytes and stage timings for dry-run scenarios.
 * Usage: npx tsx scripts/c2-pipeline-performance-probe.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnv } from "@/cli/loadEnv";
import { runDiscovery } from "@/discovery/runDiscovery";
import type { DiscoveryEvent } from "@/discovery/events";

loadLocalEnv();

const OUT_DIR = resolve(process.cwd(), ".local-audits/traces/c2-pipeline-performance");

type Scenario = {
  id: string;
  command: string;
};

const SCENARIOS: Scenario[] = [
  {
    id: "light-strict",
    command:
      "find upcoming AI hackathons in Toronto from 2026-07-15 to 2027-01-15 --profile light --dry-run",
  },
  {
    id: "deep-remote",
    command: "find remote AI hackathons in the next 6 months --profile deep --dry-run",
  },
  {
    id: "devpost-deep",
    command: "find AI hackathons from Devpost in the next 6 months --profile deep --dry-run",
  },
  {
    id: "luma-deep",
    command: "find AI hackathons from Luma in the next 6 months --profile deep --dry-run",
  },
];

async function runScenario(scenario: Scenario) {
  const events: DiscoveryEvent[] = [];
  const started = Date.now();
  let firstSourceProgressAt: number | null = null;
  const result = await runDiscovery({
    command: scenario.command,
    dryRun: true,
    eventSink: {
      emit(event) {
        const full = event as DiscoveryEvent;
        events.push(full);
        if (
          firstSourceProgressAt == null &&
          (full.type === "source_progress" || full.type === "source_started")
        ) {
          firstSourceProgressAt = Date.now();
        }
      },
    },
  });
  const durationMs = Date.now() - started;
  const serialized = JSON.stringify(events);
  const progressEvents = events.filter((e) => e.type === "source_progress");
  const coalescing = (events.find((e) => e.type === "run_completed")?.metadata
    ?.progressCoalescing ?? {}) as Record<string, { rawCallbacks?: number; emitted?: number }>;
  const rawCallbacks = Object.values(coalescing).reduce(
    (sum, row) => sum + (row.rawCallbacks ?? 0),
    0,
  );
  const emittedProgress = Object.values(coalescing).reduce(
    (sum, row) => sum + (row.emitted ?? 0),
    0,
  );

  return {
    id: scenario.id,
    command: scenario.command,
    durationMs,
    cancelled: result.cancelled,
    summary: {
      rawLeads: result.summary.rawLeads,
      uniqueLeads: result.summary.uniqueLeads,
      accepted: result.summary.accepted,
      wouldCreate: result.summary.wouldCreate,
      stored: result.summary.stored,
      dryRun: result.summary.dryRun,
      performance: result.summary.performance ?? null,
    },
    events: {
      count: events.length,
      progressCount: progressEvents.length,
      bytes: Buffer.byteLength(serialized, "utf8"),
      types: Object.fromEntries(
        [...new Set(events.map((e) => e.type))].map((type) => [
          type,
          events.filter((e) => e.type === type).length,
        ]),
      ),
    },
    coalescing: {
      rawCallbacks,
      emittedProgress,
      ratio: rawCallbacks > 0 ? Number((emittedProgress / rawCallbacks).toFixed(3)) : null,
      bySource: coalescing,
    },
    timing: {
      timeToFirstSourceUpdateMs:
        firstSourceProgressAt != null ? firstSourceProgressAt - started : null,
      totalMs: durationMs,
    },
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const selected = process.argv.includes("--quick")
    ? SCENARIOS.filter((s) => s.id === "light-strict" || s.id === "devpost-deep")
    : SCENARIOS;
  const rows = [];
  for (const scenario of selected) {
    console.log(`\n=== ${scenario.id} ===`);
    const row = await runScenario(scenario);
    rows.push(row);
    console.log(
      JSON.stringify(
        {
          id: row.id,
          durationMs: row.durationMs,
          events: row.events.count,
          progressEvents: row.events.progressCount,
          bytes: row.events.bytes,
          coalescingRatio: row.coalescing.ratio,
          rawLeads: row.summary.rawLeads,
          accepted: row.summary.accepted,
          stored: row.summary.stored,
        },
        null,
        2,
      ),
    );
  }
  const outPath = resolve(OUT_DIR, `probe-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
