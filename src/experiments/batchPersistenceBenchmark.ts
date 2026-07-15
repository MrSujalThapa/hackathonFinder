#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { loadLocalEnv } from "@/cli/loadEnv";
import type { SourceName } from "@/core/discovery/types";
import { runDiscovery } from "@/discovery/runDiscovery";
import {
  BatchPersistenceRepository,
  createSupabaseBatchPersistenceAdapter,
  type BatchPersistenceMetrics,
  type BatchPersistenceWriteResult,
} from "@/discovery/persistence/batchPersistenceRepository";
import {
  compareEvidenceFinalStates,
  evidenceRowsToStateMap,
  simulateBatchEvidenceFinalState,
  simulateV1EvidenceFinalState,
  type EvidenceFinalStateComparison,
} from "@/discovery/persistence/evidenceFinalState";
import {
  planPersistence,
  type CandidateRow,
  type EvidenceRow,
  type IncomingCandidateWrite,
  type PersistencePlan,
} from "@/discovery/persistence/persistencePlan";
import { createServiceSupabaseClient } from "@/lib/supabase/createServiceClient";
import type { Database } from "@/lib/supabase/database.types";

const BENCHMARK_BRANCH = "experiment/phase-3a-2-live-batch-benchmark";
const TRACE_DIR = ".local-audits/traces/phase-3a-2";

type AgentRunRow = Database["public"]["Tables"]["agent_runs"]["Row"];
type ActionRow = Database["public"]["Tables"]["candidate_actions"]["Row"];

export type BenchmarkArgs = {
  runId?: string;
  selectLatestBounded: boolean;
  writeExperiment: boolean;
  confirmBatchPersistenceExperiment: boolean;
  sourceTimeoutMs?: number;
  totalTimeoutMs?: number;
};

type BenchmarkPlan = {
  run: AgentRunRow;
  writeSet: IncomingCandidateWrite[];
  planNow: string;
  repository: BatchPersistenceRepository;
  existingCandidates: CandidateRow[];
  existingEvidence: EvidenceRow[];
  existingActions: ActionRow[];
  plan: PersistencePlan;
  lookupMetrics: BatchPersistenceMetrics;
  evidenceFinalState: EvidenceFinalStateComparison;
  estimatedDatabaseCalls: number;
  timings: {
    inputReconstructionMs: number;
    candidateLookupMs: number;
    evidenceLookupMs: number;
    actionSnapshotMs: number;
    planningMs: number;
    totalPlanMs: number;
  };
};

type ReplayResult = {
  label: string;
  write?: BatchPersistenceWriteResult;
  postCandidates: CandidateRow[];
  postEvidence: EvidenceRow[];
  postActions: ActionRow[];
  evidenceFinalState: EvidenceFinalStateComparison;
  candidateParity: "pass" | "fail";
  statusParity: "pass" | "fail";
  evidenceParity: "pass" | "fail";
  actionParity: "pass" | "fail";
  unexpectedRows: number;
  missingRows: number;
  duplicateEvidenceRows: number;
  timings: {
    writeMs: number;
    postVerificationMs: number;
  };
};

type WriteGuardOptions = {
  branch?: string;
  env?: Record<string, string | undefined>;
};

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function parseArgs(argv: string[]): BenchmarkArgs {
  const args: BenchmarkArgs = {
    selectLatestBounded: false,
    writeExperiment: false,
    confirmBatchPersistenceExperiment: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--run-id=")) {
      args.runId = arg.slice("--run-id=".length);
    } else if (arg === "--select-latest-bounded") {
      args.selectLatestBounded = true;
    } else if (arg === "--write-experiment") {
      args.writeExperiment = true;
    } else if (arg === "--confirm-batch-persistence-experiment") {
      args.confirmBatchPersistenceExperiment = true;
    } else if (arg.startsWith("--source-timeout-ms=")) {
      args.sourceTimeoutMs = Number(arg.slice("--source-timeout-ms=".length));
    } else if (arg.startsWith("--total-timeout-ms=")) {
      args.totalTimeoutMs = Number(arg.slice("--total-timeout-ms=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.runId && args.selectLatestBounded) {
    throw new Error("Use either --run-id or --select-latest-bounded, not both.");
  }
  if (!args.runId && !args.selectLatestBounded) {
    throw new Error("Provide --run-id=<id> or --select-latest-bounded.");
  }
  return args;
}

function currentBranch(): string {
  return execFileSync("git", ["branch", "--show-current"], {
    encoding: "utf8",
  }).trim();
}

function assertWriteAllowed(args: BenchmarkArgs, options: WriteGuardOptions = {}): void {
  if (!args.writeExperiment || !args.confirmBatchPersistenceExperiment) {
    throw new Error("Live writes require both confirmation flags.");
  }
  const branch = options.branch ?? currentBranch();
  if (branch !== BENCHMARK_BRANCH) {
    throw new Error(`Refusing live batch write on branch ${branch}. Expected ${BENCHMARK_BRANCH}.`);
  }
  const env = options.env ?? process.env;
  if (
    env.NODE_ENV === "production" ||
    env.VERCEL === "1" ||
    env.NETLIFY === "true" ||
    env.CI === "true"
  ) {
    throw new Error("Refusing live batch write in a production-like environment.");
  }
}

function isExactBoundedSources(sources: unknown): sources is string[] {
  if (!Array.isArray(sources)) return false;
  return sources.length === 3 && sources.slice().sort().join(",") === "devpost,hacklist,mlh";
}

async function loadAgentRun(args: BenchmarkArgs): Promise<AgentRunRow> {
  const supabase = createServiceSupabaseClient();
  if (args.selectLatestBounded) {
    const { data, error } = await supabase
      .from("agent_runs")
      .select("*")
      .eq("status", "COMPLETED")
      .order("finished_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(`Failed to select latest bounded run: ${error.message}`);
    const bounded = ((data ?? []) as AgentRunRow[]).find((run) => isExactBoundedSources(run.sources));
    if (!bounded) throw new Error("No completed exact bounded run found.");
    return bounded;
  }

  const { data, error } = await supabase
    .from("agent_runs")
    .select("*")
    .eq("id", args.runId!)
    .maybeSingle();
  if (error) throw new Error(`Failed to load run ${args.runId}: ${error.message}`);
  if (!data) throw new Error(`Run not found: ${args.runId}`);
  return data as AgentRunRow;
}

function sourceNamesFromRun(run: AgentRunRow): SourceName[] {
  const rawSources = Array.isArray(run.sources) ? run.sources : [];
  if (rawSources.includes("x")) {
    throw new Error("Refusing to benchmark a run that includes X.");
  }
  const sources = rawSources.filter((source): source is SourceName =>
    ["hacklist", "hakku", "devpost", "mlh", "luma", "web", "mock"].includes(source),
  );
  if (sources.length !== rawSources.length) {
    throw new Error("Refusing to benchmark a run with unsupported sources.");
  }
  return sources;
}

function maxResultsFromRun(run: AgentRunRow): number | undefined {
  const preferences = run.preferences as Record<string, unknown>;
  const value = preferences?.maxResults;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function reconstructWriteSet(
  run: AgentRunRow,
  args: BenchmarkArgs,
): Promise<{ writeSet: IncomingCandidateWrite[]; durationMs: number }> {
  let writeSet: IncomingCandidateWrite[] = [];
  const startedAt = performance.now();
  await runDiscovery({
    command: run.command,
    mode: "deterministic",
    dryRun: true,
    sources: sourceNamesFromRun(run),
    maxResults: maxResultsFromRun(run),
    sourceTimeoutMs: args.sourceTimeoutMs,
    totalTimeoutMs: args.totalTimeoutMs,
    verbose: false,
    eventSink: { emit: () => {} },
    onAcceptedWriteSet: (next) => {
      writeSet = next;
    },
  });
  if (writeSet.length === 0) {
    throw new Error("Reconstructed run produced no accepted candidates.");
  }
  return {
    writeSet,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

async function fetchActions(candidateIds: string[]): Promise<ActionRow[]> {
  if (candidateIds.length === 0) return [];
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("candidate_actions")
    .select("*")
    .in("candidate_id", [...new Set(candidateIds)].sort());
  if (error) throw new Error(`Failed to load candidate actions: ${error.message}`);
  return (data ?? []) as ActionRow[];
}

function affectedCandidateIds(plan: PersistencePlan, existingCandidates: CandidateRow[]): string[] {
  return [
    ...existingCandidates.map((candidate) => candidate.id),
    ...plan.candidateUpdates.map((candidate) => candidate.id),
  ].filter(Boolean);
}

function verifyPlanSafety(plan: PersistencePlan): void {
  if (plan.candidateCreates.length > 0) {
    throw new Error(
      `Refusing live benchmark with ${plan.candidateCreates.length} candidate creates. Reconstruct a fully persisted run first.`,
    );
  }
  for (const update of plan.candidateUpdates) {
    if (
      "status" in update.payload ||
      "approved_at" in update.payload ||
      "rejected_at" in update.payload ||
      "saved_at" in update.payload ||
      "sheet_row_id" in update.payload ||
      "sheet_appended_at" in update.payload
    ) {
      throw new Error(`Unsafe candidate update payload for ${hashValue(update.fingerprint)}.`);
    }
  }
  for (const action of plan.actionsToCreate) {
    if (
      action.action.action !== "UPDATE_FROM_DUPLICATE" ||
      action.action.previousStatus !== action.action.newStatus
    ) {
      throw new Error(`Unsafe candidate action for ${hashValue(action.candidateFingerprint)}.`);
    }
  }
}

async function buildBenchmarkPlan(run: AgentRunRow, args: BenchmarkArgs): Promise<BenchmarkPlan> {
  const totalStartedAt = performance.now();
  const repository = new BatchPersistenceRepository(createSupabaseBatchPersistenceAdapter());
  const reconstructed = await reconstructWriteSet(run, args);
  const lookupMetrics: BatchPersistenceMetrics = {
    databaseCalls: 0,
    chunks: {},
    retries: 0,
    splitBatches: 0,
  };
  const fingerprints = reconstructed.writeSet.map((item) => item.candidate.fingerprint);
  const candidateLookupStartedAt = performance.now();
  const candidateLoad = await repository.fetchCandidatesByFingerprints(fingerprints, lookupMetrics);
  const candidateLookupMs = Math.round(performance.now() - candidateLookupStartedAt);
  const candidateIds = candidateLoad.rows.map((candidate) => candidate.id);
  const evidenceLookupStartedAt = performance.now();
  const evidenceLoad = await repository.fetchEvidenceByCandidateIds(candidateIds, candidateLoad.metrics);
  const evidenceLookupMs = Math.round(performance.now() - evidenceLookupStartedAt);
  const actionSnapshotStartedAt = performance.now();
  const existingActions = await fetchActions(candidateIds);
  const actionSnapshotMs = Math.round(performance.now() - actionSnapshotStartedAt);
  const planningStartedAt = performance.now();
  const planNow = new Date().toISOString();
  const plan = planPersistence(reconstructed.writeSet, candidateLoad.rows, evidenceLoad.rows, {
    now: planNow,
  });
  const finalState = compareEvidenceFinalStates({
    v1: simulateV1EvidenceFinalState(reconstructed.writeSet, candidateLoad.rows, evidenceLoad.rows, {
      now: planNow,
    }),
    batch: simulateBatchEvidenceFinalState(plan, evidenceLoad.rows),
    batchMutationCount: plan.evidenceCreates.length + plan.evidenceUpdates.length,
  });
  const planningMs = Math.round(performance.now() - planningStartedAt);
  verifyPlanSafety(plan);
  return {
    run,
    writeSet: reconstructed.writeSet,
    planNow,
    repository,
    existingCandidates: candidateLoad.rows,
    existingEvidence: evidenceLoad.rows,
    existingActions,
    plan,
    lookupMetrics: evidenceLoad.metrics,
    evidenceFinalState: finalState,
    estimatedDatabaseCalls: evidenceLoad.metrics.databaseCalls + repository.estimateWriteCalls(plan),
    timings: {
      inputReconstructionMs: reconstructed.durationMs,
      candidateLookupMs,
      evidenceLookupMs,
      actionSnapshotMs,
      planningMs,
      totalPlanMs: Math.round(performance.now() - totalStartedAt),
    },
  };
}

function candidateParity(pre: CandidateRow[], post: CandidateRow[]): "pass" | "fail" {
  const preById = new Map(pre.map((row) => [row.id, row]));
  for (const row of post) {
    const before = preById.get(row.id);
    if (!before) continue;
    if (row.fingerprint !== before.fingerprint) return "fail";
    if (row.status !== before.status) return "fail";
    if (row.approved_at !== before.approved_at) return "fail";
    if (row.rejected_at !== before.rejected_at) return "fail";
    if (row.saved_at !== before.saved_at) return "fail";
    if (row.sheet_row_id !== before.sheet_row_id) return "fail";
    if (row.sheet_appended_at !== before.sheet_appended_at) return "fail";
  }
  return "pass";
}

function duplicateEvidenceCount(rows: EvidenceRow[]): number {
  const keys = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    const key = `${row.candidate_id}\u0000${row.type}\u0000${row.url_key}`;
    if (keys.has(key)) duplicates += 1;
    keys.add(key);
  }
  return duplicates;
}

function evidenceExistenceDeltas(comparison: EvidenceFinalStateComparison): {
  missingRows: number;
  unexpectedRows: number;
} {
  let missingRows = 0;
  let unexpectedRows = 0;
  for (const diff of comparison.differences) {
    if (diff.field !== "existence") continue;
    if (diff.expected === "present" && diff.actual === "missing") missingRows += 1;
    if (diff.expected === "missing" && diff.actual === "present") unexpectedRows += 1;
  }
  return { missingRows, unexpectedRows };
}

async function verifyReplay(
  label: string,
  benchmark: BenchmarkPlan,
  write?: BatchPersistenceWriteResult,
): Promise<ReplayResult> {
  const verificationStartedAt = performance.now();
  const candidateIds = affectedCandidateIds(benchmark.plan, benchmark.existingCandidates);
  const candidateLoad = await benchmark.repository.fetchCandidatesByFingerprints(
    benchmark.writeSet.map((item) => item.candidate.fingerprint),
  );
  const evidenceLoad = await benchmark.repository.fetchEvidenceByCandidateIds(candidateIds);
  const postActions = await fetchActions(candidateIds);
  const expectedEvidence = simulateV1EvidenceFinalState(
    benchmark.writeSet,
    benchmark.existingCandidates,
    benchmark.existingEvidence,
    { now: benchmark.planNow },
  );
  const evidenceFinalState = compareEvidenceFinalStates({
    v1: expectedEvidence,
    batch: evidenceRowsToStateMap(evidenceLoad.rows),
    batchMutationCount: benchmark.plan.evidenceCreates.length + benchmark.plan.evidenceUpdates.length,
  });
  const expectedActionDelta = benchmark.plan.actionsToCreate.length;
  const actualActionDelta = postActions.length - benchmark.existingActions.length;
  const existence = evidenceExistenceDeltas(evidenceFinalState);

  return {
    label,
    write,
    postCandidates: candidateLoad.rows,
    postEvidence: evidenceLoad.rows,
    postActions,
    evidenceFinalState,
    candidateParity: candidateParity(benchmark.existingCandidates, candidateLoad.rows),
    statusParity: candidateParity(benchmark.existingCandidates, candidateLoad.rows),
    evidenceParity: evidenceFinalState.parity,
    actionParity: actualActionDelta === expectedActionDelta ? "pass" : "fail",
    unexpectedRows: existence.unexpectedRows,
    missingRows: existence.missingRows,
    duplicateEvidenceRows: duplicateEvidenceCount(evidenceLoad.rows),
    timings: {
      writeMs: write?.timings.totalMs ?? 0,
      postVerificationMs: Math.round(performance.now() - verificationStartedAt),
    },
  };
}

async function writeTrace(name: string, body: unknown): Promise<void> {
  await mkdir(TRACE_DIR, { recursive: true });
  await writeFile(
    path.join(TRACE_DIR, name),
    typeof body === "string" ? body : JSON.stringify(body, null, 2),
  );
}

function safePlanSummary(benchmark: BenchmarkPlan): Record<string, unknown> {
  return {
    runId: benchmark.run.id,
    commandHash: hashValue(benchmark.run.command),
    sources: benchmark.run.sources,
    runStatus: benchmark.run.status,
    finishedAt: benchmark.run.finished_at,
    incomingCandidates: benchmark.plan.diagnostics.incomingCandidates,
    candidateCreates: benchmark.plan.candidateCreates.length,
    candidateUpdates: benchmark.plan.candidateUpdates.length,
    candidateUnchanged: benchmark.plan.candidateUnchanged.length,
    incomingObservations: benchmark.plan.diagnostics.incomingEvidence,
    evidenceIdentities: benchmark.plan.diagnostics.uniqueEvidence,
    evidenceMutations: benchmark.plan.evidenceCreates.length + benchmark.plan.evidenceUpdates.length,
    duplicateObservations: benchmark.plan.diagnostics.duplicateEvidenceObservations,
    actions: benchmark.plan.actionsToCreate.length,
    estimatedDatabaseCalls: benchmark.estimatedDatabaseCalls,
    evidenceFinalStateParity: benchmark.evidenceFinalState.parity,
    seenCountParity: benchmark.evidenceFinalState.seenCountParity,
    lastSeenAtParity: benchmark.evidenceFinalState.lastSeenAtParity,
    agentRunParity: benchmark.evidenceFinalState.agentRunParity,
    duplicateIdentityHashes: benchmark.evidenceFinalState.duplicateIdentityHashes,
    timings: benchmark.timings,
  };
}

function estimateV1PersistenceModel(benchmark: BenchmarkPlan): Record<string, number> {
  const candidateCreates = benchmark.plan.candidateCreates.length;
  const candidateUpdates = benchmark.plan.candidateUpdates.length;
  const evidenceOperations = benchmark.plan.diagnostics.incomingEvidence;
  return {
    pipelineCountedOperations: candidateCreates + candidateUpdates + evidenceOperations,
    candidateCreates,
    candidateUpdates,
    evidenceOperations,
    estimatedLowLevelDatabaseCalls:
      candidateCreates * 2 + candidateUpdates * 3 + evidenceOperations * 2,
  };
}

function printReadOnlySummary(benchmark: BenchmarkPlan): void {
  const summary = safePlanSummary(benchmark);
  console.log("[batch-benchmark] Read-only plan");
  console.log("");
  console.log(`  incoming candidates        ${summary.incomingCandidates}`);
  console.log(`  candidate creates          ${summary.candidateCreates}`);
  console.log(`  candidate updates          ${summary.candidateUpdates}`);
  console.log(`  candidate unchanged        ${summary.candidateUnchanged}`);
  console.log(`  incoming observations      ${summary.incomingObservations}`);
  console.log(`  evidence identities        ${summary.evidenceIdentities}`);
  console.log(`  evidence mutations         ${summary.evidenceMutations}`);
  console.log(`  duplicate observations     ${summary.duplicateObservations}`);
  console.log(`  actions                    ${summary.actions}`);
  console.log(`  estimated DB calls         ${summary.estimatedDatabaseCalls}`);
  console.log(`  evidence final-state       ${summary.evidenceFinalStateParity}`);
  console.log(`  seen-count parity          ${summary.seenCountParity}`);
  console.log(`  last-seen parity           ${summary.lastSeenAtParity}`);
  console.log("  batch writes        disabled");
}

function printLiveSummary(first: ReplayResult, second: ReplayResult, benchmark: BenchmarkPlan): void {
  const write = first.write;
  console.log("[batch-benchmark] Live write");
  console.log("");
  console.log(`  input reconstruction       ${benchmark.timings.inputReconstructionMs}ms`);
  console.log(`  candidate lookup           ${benchmark.timings.candidateLookupMs}ms`);
  console.log(`  candidate creates          ${write?.timings.candidateCreatesMs ?? 0}ms`);
  console.log(`  candidate updates          ${write?.timings.candidateUpdatesMs ?? 0}ms`);
  console.log(`  evidence lookup            ${benchmark.timings.evidenceLookupMs}ms`);
  console.log(`  evidence creates           ${write?.timings.evidenceCreatesMs ?? 0}ms`);
  console.log(`  evidence updates           ${write?.timings.evidenceUpdatesMs ?? 0}ms`);
  console.log(`  actions                    ${write?.timings.actionsMs ?? 0}ms`);
  console.log(`  batch write total          ${write?.timings.totalMs ?? 0}ms`);
  console.log(`  post-write verification    ${first.timings.postVerificationMs}ms`);
  console.log(`  database calls             ${(write?.metrics.databaseCalls ?? 0) + benchmark.lookupMetrics.databaseCalls}`);
  console.log(`  retries                    ${write?.metrics.retries ?? 0}`);
  console.log(`  split batches              ${write?.metrics.splitBatches ?? 0}`);
  console.log(`  first final-state parity   ${first.evidenceParity}`);
  console.log(`  second final-state parity  ${second.evidenceParity}`);
  console.log(`  second structural replay   ${second.duplicateEvidenceRows === 0 ? "pass" : "fail"}`);
}

async function runBenchmark(args: BenchmarkArgs): Promise<void> {
  const run = await loadAgentRun(args);
  const benchmark = await buildBenchmarkPlan(run, args);
  await writeTrace("selected-run.md", `# Selected Run\n\n- run id: ${run.id}\n- command hash: ${hashValue(run.command)}\n- sources: ${run.sources.join(", ")}\n`);
  await writeTrace("pre-write-summary.md", safePlanSummary(benchmark));
  await writeTrace("read-only-plan.md", safePlanSummary(benchmark));
  printReadOnlySummary(benchmark);

  if (!args.writeExperiment || !args.confirmBatchPersistenceExperiment) {
    return;
  }

  assertWriteAllowed(args);
  const firstWrite = await benchmark.repository.writePlan(benchmark.plan);
  const first = await verifyReplay("first", benchmark, firstWrite);
  await writeTrace("post-write-parity.md", {
    candidateParity: first.candidateParity,
    statusParity: first.statusParity,
    evidenceParity: first.evidenceParity,
    actionParity: first.actionParity,
    duplicateEvidenceRows: first.duplicateEvidenceRows,
    timings: first.timings,
  });

  const secondBenchmark = await buildBenchmarkPlan(run, args);
  const secondWrite = await secondBenchmark.repository.writePlan(secondBenchmark.plan);
  const second = await verifyReplay("second", secondBenchmark, secondWrite);
  await writeTrace("second-replay.md", {
    candidateParity: second.candidateParity,
    statusParity: second.statusParity,
    evidenceParity: second.evidenceParity,
    actionParity: second.actionParity,
    duplicateEvidenceRows: second.duplicateEvidenceRows,
    timings: second.timings,
  });
  await writeTrace("live-benchmark.md", {
    firstWrite: first.write?.timings,
    firstMetrics: first.write?.metrics,
    secondWrite: second.write?.timings,
    secondMetrics: second.write?.metrics,
  });
  await writeTrace("v1-batch-comparison.md", {
    v1: estimateV1PersistenceModel(benchmark),
    batch: {
      lookupDatabaseCalls: benchmark.lookupMetrics.databaseCalls,
      writeDatabaseCalls: first.write?.metrics.databaseCalls ?? 0,
      totalDatabaseCalls: (first.write?.metrics.databaseCalls ?? 0) + benchmark.lookupMetrics.databaseCalls,
      candidateLookupMs: benchmark.timings.candidateLookupMs,
      evidenceLookupMs: benchmark.timings.evidenceLookupMs,
      writeMs: first.write?.timings.totalMs ?? 0,
      lookupAndWriteMs:
        benchmark.timings.candidateLookupMs +
        benchmark.timings.evidenceLookupMs +
        (first.write?.timings.totalMs ?? 0),
    },
  });
  printLiveSummary(first, second, benchmark);
}

async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseArgs(process.argv);
  await runBenchmark(args);
}

if (process.argv[1]?.endsWith("batchPersistenceBenchmark.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Batch benchmark failed");
    process.exit(1);
  });
}

export {
  assertWriteAllowed,
  parseArgs,
  verifyPlanSafety,
  safePlanSummary,
  candidateParity,
  evidenceExistenceDeltas,
};
