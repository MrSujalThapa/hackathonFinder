import { performance } from "node:perf_hooks";
import type { DiscoverySourceId } from "@/core/discovery/types";

export type StageTiming = {
  name: string;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  itemCount?: number;
  metadata?: Record<string, string | number | boolean>;
  children?: StageTiming[];
};

export type CollectorTiming = {
  source: DiscoverySourceId;
  waitMs: number;
  executionMs: number;
  totalMs: number;
  rawLeadCount: number;
  returnedLeadCount: number;
  outcome: string;
  diagnostics?: Record<string, string | number | boolean>;
};

export type PersistenceTiming = {
  skipped: boolean;
  totalMs: number;
  candidateMs: number;
  evidenceMs: number;
  completionMs: number;
  acceptedCandidates: number;
  candidateLookups: number;
  candidateInserts: number;
  candidateUpdates: number;
  candidateFailures: number;
  evidenceLookups: number;
  evidenceInserts: number;
  evidenceUpdates: number;
  evidenceFailures: number;
  databaseCalls: number;
};

export type DiscoveryPerformanceSummary = {
  stages: StageTiming[];
  collectors: Record<string, CollectorTiming>;
  queueWaitMs?: number;
  jobStartOverheadMs?: number;
  commandParsingMs?: number;
  planningMs?: number;
  sourcePlanMs?: number;
  collectionMs?: number;
  customSourceCollectionMs?: number;
  enrichmentMs?: number;
  extractionMs?: number;
  dedupeMs?: number;
  verificationMs?: number;
  persistence?: PersistenceTiming;
  completionMs?: number;
  totalMs: number;
};

type StageName =
  | "commandParsing"
  | "planning"
  | "sourcePlan"
  | "collection"
  | "customSourceCollection"
  | "enrichment"
  | "extraction"
  | "dedupe"
  | "verification"
  | "persistence"
  | "completion";

const SUMMARY_FIELD_BY_STAGE: Partial<Record<StageName, keyof DiscoveryPerformanceSummary>> = {
  commandParsing: "commandParsingMs",
  planning: "planningMs",
  sourcePlan: "sourcePlanMs",
  collection: "collectionMs",
  customSourceCollection: "customSourceCollectionMs",
  enrichment: "enrichmentMs",
  extraction: "extractionMs",
  dedupe: "dedupeMs",
  verification: "verificationMs",
  completion: "completionMs",
};

function roundMs(value: number): number {
  return Math.max(0, Math.round(value));
}

export class DiscoveryPerformanceTracker {
  private readonly originMs = performance.now();
  private readonly stages: StageTiming[] = [];
  private readonly collectors = new Map<string, CollectorTiming>();
  private readonly summary: DiscoveryPerformanceSummary = {
    stages: this.stages,
    collectors: {},
    totalMs: 0,
  };

  constructor(seed: Pick<DiscoveryPerformanceSummary, "queueWaitMs" | "jobStartOverheadMs"> = {}) {
    if (seed.queueWaitMs != null) this.summary.queueWaitMs = roundMs(seed.queueWaitMs);
    if (seed.jobStartOverheadMs != null) {
      this.summary.jobStartOverheadMs = roundMs(seed.jobStartOverheadMs);
    }
  }

  now(): number {
    return performance.now();
  }

  async measure<T>(
    name: StageName,
    fn: () => Promise<T>,
    options: { itemCount?: number; metadata?: StageTiming["metadata"] } = {},
  ): Promise<T> {
    const startedAtMs = this.now();
    try {
      return await fn();
    } finally {
      this.recordStage(name, startedAtMs, this.now(), options);
    }
  }

  measureSync<T>(
    name: StageName,
    fn: () => T,
    options: { itemCount?: number; metadata?: StageTiming["metadata"] } = {},
  ): T {
    const startedAtMs = this.now();
    try {
      return fn();
    } finally {
      this.recordStage(name, startedAtMs, this.now(), options);
    }
  }

  recordStage(
    name: StageName,
    startedAtMs: number,
    endedAtMs: number,
    options: { itemCount?: number; metadata?: StageTiming["metadata"] } = {},
  ): StageTiming {
    const timing: StageTiming = {
      name,
      startedAtMs: roundMs(startedAtMs - this.originMs),
      endedAtMs: roundMs(endedAtMs - this.originMs),
      durationMs: roundMs(endedAtMs - startedAtMs),
      ...(options.itemCount != null ? { itemCount: options.itemCount } : {}),
      ...(options.metadata ? { metadata: options.metadata } : {}),
    };
    this.stages.push(timing);
    const field = SUMMARY_FIELD_BY_STAGE[name];
    if (field) {
      (this.summary[field] as number | undefined) =
        ((this.summary[field] as number | undefined) ?? 0) + timing.durationMs;
    }
    return timing;
  }

  recordCollector(timing: CollectorTiming): void {
    this.collectors.set(timing.source, {
      ...timing,
      waitMs: roundMs(timing.waitMs),
      executionMs: roundMs(timing.executionMs),
      totalMs: roundMs(timing.totalMs),
    });
  }

  setPersistence(timing: PersistenceTiming): void {
    this.summary.persistence = {
      ...timing,
      totalMs: roundMs(timing.totalMs),
      candidateMs: roundMs(timing.candidateMs),
      evidenceMs: roundMs(timing.evidenceMs),
      completionMs: roundMs(timing.completionMs),
    };
  }

  finalize(): DiscoveryPerformanceSummary {
    const collectors: Record<string, CollectorTiming> = {};
    for (const [source, timing] of this.collectors) {
      collectors[source] = timing;
    }
    this.summary.collectors = collectors;
    this.summary.totalMs = roundMs(this.now() - this.originMs);
    return {
      ...this.summary,
      stages: [...this.stages],
      collectors: { ...collectors },
      persistence: this.summary.persistence ? { ...this.summary.persistence } : undefined,
    };
  }
}

export function createDiscoveryPerformanceTracker(
  seed: Pick<DiscoveryPerformanceSummary, "queueWaitMs" | "jobStartOverheadMs"> = {},
): DiscoveryPerformanceTracker {
  return new DiscoveryPerformanceTracker(seed);
}

function formatSeconds(ms: number | undefined): string {
  if (ms == null) return "not run";
  return `${(ms / 1000).toFixed(1)}s`;
}

function line(label: string, value: string, indent = 2): string {
  return `${" ".repeat(indent)}${label.padEnd(22)}${value.padStart(9)}`;
}

export function formatPerformanceSummary(summary: DiscoveryPerformanceSummary): string[] {
  const lines = ["[performance] Run timing"];
  if (summary.queueWaitMs != null) lines.push(line("queue wait", formatSeconds(summary.queueWaitMs)));
  if (summary.jobStartOverheadMs != null) {
    lines.push(line("job start overhead", formatSeconds(summary.jobStartOverheadMs)));
  }
  if (summary.commandParsingMs != null) {
    lines.push(line("command parsing", formatSeconds(summary.commandParsingMs)));
  }
  if (summary.planningMs != null) lines.push(line("planning", formatSeconds(summary.planningMs)));
  if (summary.sourcePlanMs != null) {
    lines.push(line("source plan", formatSeconds(summary.sourcePlanMs)));
  }
  if (summary.collectionMs != null) {
    lines.push(line("collection", formatSeconds(summary.collectionMs)));
    for (const collector of Object.values(summary.collectors)) {
      lines.push(line(String(collector.source), formatSeconds(collector.totalMs), 4));
      lines.push(line("source wait", formatSeconds(collector.waitMs), 6));
      lines.push(line("execution", formatSeconds(collector.executionMs), 6));
      lines.push(line("returned leads", String(collector.returnedLeadCount), 6));
      lines.push(line("outcome", collector.outcome, 6));
    }
  }
  if (summary.customSourceCollectionMs != null) {
    lines.push(line("custom sources", formatSeconds(summary.customSourceCollectionMs)));
  }
  if (summary.enrichmentMs != null) {
    lines.push(line("shared enrichment", formatSeconds(summary.enrichmentMs)));
  }
  if (summary.extractionMs != null) lines.push(line("extraction", formatSeconds(summary.extractionMs)));
  if (summary.dedupeMs != null) lines.push(line("dedupe", formatSeconds(summary.dedupeMs)));
  if (summary.verificationMs != null) {
    lines.push(line("verification", formatSeconds(summary.verificationMs)));
  }
  if (summary.persistence) {
    if (summary.persistence.skipped) {
      lines.push(line("persistence", "skipped (dry run)"));
    } else {
      lines.push(line("persistence", formatSeconds(summary.persistence.totalMs)));
      lines.push(line("candidates", formatSeconds(summary.persistence.candidateMs), 4));
      lines.push(line("evidence", formatSeconds(summary.persistence.evidenceMs), 4));
      lines.push(line("completion state", formatSeconds(summary.persistence.completionMs), 4));
      lines.push(line("database calls", String(summary.persistence.databaseCalls), 4));
    }
  }
  if (summary.completionMs != null) {
    lines.push(line("agent completion", formatSeconds(summary.completionMs)));
  }
  lines.push(line("total", formatSeconds(summary.totalMs)));
  return lines;
}
