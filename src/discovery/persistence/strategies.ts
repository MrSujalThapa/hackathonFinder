import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import type { AcceptedCandidate } from "@/core/discovery/types";
import { verifyHackathonEvent } from "@/core/verify";
import { eventEvidenceToAddInput, eventToUpsertInput } from "@/agent/summary";
import { addEvidence, upsertCandidateByFingerprint } from "@/server/candidates/repository";
import type { DiscoveryPerformanceTracker, PersistenceTiming } from "@/discovery/performance";
import {
  BatchPersistenceRepository,
  BatchPersistenceWriteError,
  createSupabaseBatchPersistenceAdapter,
  type BatchPersistenceMetrics,
  type BatchPersistenceWriteProgress,
} from "@/discovery/persistence/batchPersistenceRepository";
import {
  compareEvidenceFinalStates,
  evidenceRowsToStateMap,
  simulateV1EvidenceFinalState,
  type EvidenceFinalStateComparison,
} from "@/discovery/persistence/evidenceFinalState";
import { acceptedCandidatesToWriteSet } from "@/discovery/persistence/persistenceShadow";
import {
  planPersistence,
  type CandidateRow,
  type EvidenceRow,
  type IncomingCandidateWrite,
  type PersistencePlan,
} from "@/discovery/persistence/persistencePlan";

const TRACE_DIR = ".local-audits/traces/phase-3a-3";

export type PersistenceStrategyName = "v1" | "batch";

export type PersistenceStrategySelection = {
  name: PersistenceStrategyName;
  warning?: string;
};

export type PersistenceStrategyInput = {
  accepted: AcceptedCandidate[];
  dryRun: boolean;
  now: Date;
  agentRunId?: string | null;
  performanceTracker?: DiscoveryPerformanceTracker;
  assertNotCancelled: () => void;
};

export type PersistenceStrategyResult = {
  strategy: PersistenceStrategyName;
  created: number;
  updated: number;
  unchanged: number;
  wouldCreate: number;
  wouldUpdate: number;
  stored: number;
  duplicatesUpdated: number;
  evidenceWritten: number;
  wouldAttachEvidence: number;
  actionsWritten: number;
  storageFailures: number;
  warnings: string[];
  errors: string[];
  candidateIds: string[];
  timing: PersistenceTiming;
  postWriteParity?: "pass" | "fail" | "skipped";
  writeProgress?: BatchPersistenceWriteProgress;
};

export type PersistenceStrategy = {
  readonly name: PersistenceStrategyName;
  persist(input: PersistenceStrategyInput): Promise<PersistenceStrategyResult>;
};

function emptyTiming(
  strategy: PersistenceStrategyName,
  skipped: boolean,
  acceptedCandidates: number,
): PersistenceTiming {
  return {
    skipped,
    strategy,
    totalMs: 0,
    candidateMs: 0,
    evidenceMs: 0,
    actionMs: 0,
    completionMs: 0,
    acceptedCandidates,
    evidenceObservations: 0,
    evidenceMutations: 0,
    actionsWritten: 0,
    candidateLookups: 0,
    candidateInserts: 0,
    candidateUpdates: 0,
    candidateUnchanged: 0,
    candidateFailures: 0,
    evidenceLookups: 0,
    evidenceInserts: 0,
    evidenceUpdates: 0,
    evidenceFailures: 0,
    databaseCalls: 0,
    retries: 0,
    splitBatches: 0,
    postWriteParity: "skipped",
  };
}

export function selectPersistenceStrategyFromEnv(
  env: Record<string, string | undefined> = process.env,
): PersistenceStrategySelection {
  const raw = env.PERSISTENCE_STRATEGY?.trim().toLowerCase();
  if (!raw || raw === "v1") return { name: "v1" };
  if (raw === "batch") return { name: "batch" };
  return {
    name: "v1",
    warning: `[persistence] Invalid PERSISTENCE_STRATEGY=${JSON.stringify(raw)}; using v1.`,
  };
}

export function isBatchPostWriteVerificationEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.PERSISTENCE_BATCH_VERIFY_AFTER_WRITE === "true";
}

export function createPersistenceStrategy(
  selection: PersistenceStrategySelection,
): PersistenceStrategy {
  return selection.name === "batch" ? new BatchPersistenceStrategy() : new V1PersistenceStrategy();
}

export class V1PersistenceStrategy implements PersistenceStrategy {
  readonly name = "v1" as const;

  async persist(input: PersistenceStrategyInput): Promise<PersistenceStrategyResult> {
    const timing = emptyTiming(this.name, input.dryRun, input.accepted.length);
    const startedAt = input.performanceTracker?.now() ?? performance.now();
    const seenFingerprints = new Set<string>();
    const warnings: string[] = [];
    const errors: string[] = [];
    const candidateIds: string[] = [];
    let created = 0;
    let updated = 0;
    let wouldCreate = 0;
    let wouldUpdate = 0;
    let stored = 0;
    let duplicatesUpdated = 0;
    let evidenceWritten = 0;
    let wouldAttachEvidence = 0;
    let storageFailures = 0;

    for (const item of input.accepted) {
      input.assertNotCancelled();
      const verification = verifyHackathonEvent(item.event, { now: input.now });
      const upsertInput = eventToUpsertInput(item.event, item.score, verification, item.status);
      item.fingerprint = upsertInput.fingerprint;
      const evidenceCount = item.event.evidence.length;

      if (input.dryRun) {
        if (seenFingerprints.has(upsertInput.fingerprint)) {
          wouldUpdate += 1;
          duplicatesUpdated += 1;
        } else {
          seenFingerprints.add(upsertInput.fingerprint);
          wouldCreate += 1;
          stored += 1;
        }
        wouldAttachEvidence += evidenceCount;
        continue;
      }

      try {
        const candidateStartedAt = input.performanceTracker?.now() ?? performance.now();
        timing.candidateLookups += 1;
        timing.databaseCalls += 1;
        const result = await upsertCandidateByFingerprint(upsertInput);
        timing.candidateMs += (input.performanceTracker?.now() ?? performance.now()) - candidateStartedAt;
        candidateIds.push(result.candidate.id);
        if (result.isNew) {
          timing.candidateInserts += 1;
          created += 1;
          stored += 1;
        } else {
          timing.candidateUpdates += 1;
          timing.actionsWritten = (timing.actionsWritten ?? 0) + 1;
          updated += 1;
          duplicatesUpdated += 1;
        }

        for (const evidence of item.event.evidence) {
          try {
            const evidenceStartedAt = input.performanceTracker?.now() ?? performance.now();
            timing.evidenceLookups += 1;
            timing.databaseCalls += 1;
            const savedEvidence = await addEvidence(result.candidate.id, {
              ...eventEvidenceToAddInput(evidence),
              agentRunId: input.agentRunId,
            });
            timing.evidenceMs += (input.performanceTracker?.now() ?? performance.now()) - evidenceStartedAt;
            if ((savedEvidence.seenCount ?? 1) > 1) {
              timing.evidenceUpdates += 1;
            } else {
              timing.evidenceInserts += 1;
            }
            evidenceWritten += 1;
          } catch (error) {
            timing.evidenceFailures += 1;
            storageFailures += 1;
            warnings.push(
              `Evidence write failed for ${item.event.name}: ${
                error instanceof Error ? error.message : "unknown error"
              }`,
            );
          }
        }
      } catch (error) {
        timing.candidateFailures += 1;
        storageFailures += 1;
        errors.push(
          `Upsert failed for ${item.event.name}: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }

    timing.evidenceObservations = input.accepted.reduce(
      (total, item) => total + item.event.evidence.length,
      0,
    );
    timing.evidenceMutations = timing.evidenceInserts + timing.evidenceUpdates;
    timing.totalMs = (input.performanceTracker?.now() ?? performance.now()) - startedAt;

    return {
      strategy: this.name,
      created,
      updated,
      unchanged: timing.candidateUnchanged ?? 0,
      wouldCreate,
      wouldUpdate,
      stored,
      duplicatesUpdated,
      evidenceWritten,
      wouldAttachEvidence,
      actionsWritten: timing.actionsWritten ?? 0,
      storageFailures,
      warnings,
      errors,
      candidateIds,
      timing,
      postWriteParity: "skipped",
    };
  }
}

export class BatchPersistenceStrategy implements PersistenceStrategy {
  readonly name = "batch" as const;

  constructor(private readonly repository = new BatchPersistenceRepository(createSupabaseBatchPersistenceAdapter())) {}

  async persist(input: PersistenceStrategyInput): Promise<PersistenceStrategyResult> {
    const timing = emptyTiming(this.name, input.dryRun, input.accepted.length);
    const startedAt = input.performanceTracker?.now() ?? performance.now();
    const warnings: string[] = [];
    const errors: string[] = [];
    const writeSet = acceptedCandidatesToWriteSet(input.accepted, {
      now: input.now,
      agentRunId: input.agentRunId,
    });
    const evidenceObservations = writeSet.reduce((total, item) => total + item.evidence.length, 0);
    timing.evidenceObservations = evidenceObservations;

    if (input.dryRun) {
      const fingerprints = new Set<string>();
      for (const item of writeSet) fingerprints.add(item.candidate.fingerprint);
      timing.totalMs = (input.performanceTracker?.now() ?? performance.now()) - startedAt;
      return {
        strategy: this.name,
        created: 0,
        updated: 0,
        unchanged: 0,
        wouldCreate: fingerprints.size,
        wouldUpdate: writeSet.length - fingerprints.size,
        stored: fingerprints.size,
        duplicatesUpdated: writeSet.length - fingerprints.size,
        evidenceWritten: 0,
        wouldAttachEvidence: evidenceObservations,
        actionsWritten: 0,
        storageFailures: 0,
        warnings,
        errors,
        candidateIds: [],
        timing,
        postWriteParity: "skipped",
      };
    }

    input.assertNotCancelled();
    const planningStartedAt = input.performanceTracker?.now() ?? performance.now();
    const lookupMetrics: BatchPersistenceMetrics = {
      databaseCalls: 0,
      chunks: {},
      retries: 0,
      splitBatches: 0,
    };
    const fingerprints = writeSet.map((item) => item.candidate.fingerprint);
    const candidateLookupStartedAt = input.performanceTracker?.now() ?? performance.now();
    const candidateLoad = await this.repository.fetchCandidatesByFingerprints(fingerprints, lookupMetrics);
    const candidateLookupMs = (input.performanceTracker?.now() ?? performance.now()) - candidateLookupStartedAt;
    const evidenceLookupStartedAt = input.performanceTracker?.now() ?? performance.now();
    const evidenceLoad = await this.repository.fetchEvidenceByCandidateIds(
      candidateLoad.rows.map((candidate) => candidate.id),
      candidateLoad.metrics,
    );
    const evidenceLookupMs = (input.performanceTracker?.now() ?? performance.now()) - evidenceLookupStartedAt;
    const plan = planPersistence(writeSet, candidateLoad.rows, evidenceLoad.rows, {
      now: input.now.toISOString(),
    });
    timing.planningMs = (input.performanceTracker?.now() ?? performance.now()) - planningStartedAt;
    timing.candidateLookups = candidateLoad.metrics.chunks.candidateLookup ?? 0;
    timing.evidenceLookups = candidateLoad.metrics.chunks.evidenceLookup ?? 0;
    timing.candidateMs += candidateLookupMs;
    timing.evidenceMs += evidenceLookupMs;

    const writeResult = await this.writeBatchPlan(plan, timing, warnings, errors);
    const allCandidates = [...candidateLoad.rows, ...writeResult.createdCandidates, ...writeResult.updatedCandidates];
    const candidateIds = unique([
      ...candidateLoad.rows.map((candidate) => candidate.id),
      ...writeResult.createdCandidates.map((candidate) => candidate.id),
      ...writeResult.updatedCandidates.map((candidate) => candidate.id),
    ]);
    timing.candidateInserts = writeResult.createdCandidates.length;
    timing.candidateUpdates = writeResult.updatedCandidates.length;
    timing.candidateUnchanged = plan.candidateUnchanged.length;
    timing.evidenceInserts = writeResult.createdEvidence.length;
    timing.evidenceUpdates = writeResult.updatedEvidence.length;
    timing.evidenceMutations = plan.evidenceCreates.length + plan.evidenceUpdates.length;
    timing.actionsWritten = writeResult.createdActions.length;
    timing.databaseCalls = candidateLoad.metrics.databaseCalls + writeResult.metrics.databaseCalls;
    timing.retries = writeResult.metrics.retries;
    timing.splitBatches = writeResult.metrics.splitBatches;
    timing.totalMs = (input.performanceTracker?.now() ?? performance.now()) - startedAt;

    if (errors.length > 0) {
      return {
        strategy: this.name,
        created: writeResult.createdCandidates.length,
        updated: writeResult.updatedCandidates.length,
        unchanged: plan.candidateUnchanged.length,
        wouldCreate: 0,
        wouldUpdate: 0,
        stored: writeResult.createdCandidates.length,
        duplicatesUpdated: writeResult.updatedCandidates.length,
        evidenceWritten: writeResult.createdEvidence.length + writeResult.updatedEvidence.length,
        wouldAttachEvidence: 0,
        actionsWritten: writeResult.createdActions.length,
        storageFailures: errors.length,
        warnings,
        errors,
        candidateIds: allCandidates.map((candidate) => candidate.id),
        timing,
        postWriteParity: "skipped",
        writeProgress: writeResult.progress,
      };
    }

    let postWriteParity: "pass" | "fail" | "skipped" = "skipped";
    if (isBatchPostWriteVerificationEnabled()) {
      const verificationStartedAt = input.performanceTracker?.now() ?? performance.now();
      const comparison = await verifyBatchFinalState({
        repository: this.repository,
        writeSet,
        existingCandidates: candidateLoad.rows,
        existingEvidence: evidenceLoad.rows,
        createdCandidates: writeResult.createdCandidates,
        plan,
        now: input.now.toISOString(),
        candidateIds,
      });
      postWriteParity = comparison.parity;
      timing.postWriteVerificationMs =
        (input.performanceTracker?.now() ?? performance.now()) - verificationStartedAt;
      timing.postWriteParity = postWriteParity;
      if (postWriteParity === "fail") {
        const tracePath = await writePostWriteMismatchTrace(comparison);
        warnings.push(`[persistence] Post-write parity failed; trace: ${tracePath}`);
      }
    }

    return {
      strategy: this.name,
      created: writeResult.createdCandidates.length,
      updated: writeResult.updatedCandidates.length,
      unchanged: plan.candidateUnchanged.length,
      wouldCreate: 0,
      wouldUpdate: 0,
      stored: writeResult.createdCandidates.length,
      duplicatesUpdated: writeResult.updatedCandidates.length,
      evidenceWritten: evidenceObservations,
      wouldAttachEvidence: 0,
      actionsWritten: writeResult.createdActions.length,
      storageFailures: errors.length,
      warnings,
      errors,
      candidateIds: allCandidates.map((candidate) => candidate.id),
      timing,
      postWriteParity,
      writeProgress: writeResult.progress,
    };
  }

  private async writeBatchPlan(
    plan: PersistencePlan,
    timing: PersistenceTiming,
    warnings: string[],
    errors: string[],
  ) {
    try {
      const result = await this.repository.writePlan(plan);
      timing.candidateMs += result.timings.candidateCreatesMs + result.timings.candidateUpdatesMs;
      timing.evidenceMs += result.timings.evidenceCreatesMs + result.timings.evidenceUpdatesMs;
      timing.actionMs = result.timings.actionsMs;
      return result;
    } catch (error) {
      if (error instanceof BatchPersistenceWriteError) {
        const result = error.partialResult;
        timing.candidateMs += result.timings.candidateCreatesMs + result.timings.candidateUpdatesMs;
        timing.evidenceMs += result.timings.evidenceCreatesMs + result.timings.evidenceUpdatesMs;
        timing.actionMs = result.timings.actionsMs;
        timing.databaseCalls += result.metrics.databaseCalls;
        timing.retries = result.metrics.retries;
        timing.splitBatches = result.metrics.splitBatches;
        errors.push(`Batch persistence failed: ${error.message}`);
        warnings.push(
          `[persistence] Batch write progress: candidates=${error.progress.candidateWritesCompleted}, evidence=${error.progress.evidenceWritesCompleted}, actions=${error.progress.actionWritesCompleted}`,
        );
        return {
          ...result,
          progress: error.progress,
        };
      }
      throw error;
    }
  }
}

async function verifyBatchFinalState(input: {
  repository: BatchPersistenceRepository;
  writeSet: IncomingCandidateWrite[];
  existingCandidates: CandidateRow[];
  existingEvidence: EvidenceRow[];
  createdCandidates: CandidateRow[];
  plan: PersistencePlan;
  now: string;
  candidateIds: string[];
}): Promise<EvidenceFinalStateComparison> {
  const evidenceLoad = await input.repository.fetchEvidenceByCandidateIds(input.candidateIds);
  const candidateIdByFingerprint = new Map(
    input.createdCandidates.map((candidate) => [candidate.fingerprint, candidate.id]),
  );
  return compareEvidenceFinalStates({
    v1: simulateV1EvidenceFinalState(
      input.writeSet,
      input.existingCandidates,
      input.existingEvidence,
      { now: input.now, candidateIdByFingerprint },
    ),
    batch: evidenceRowsToStateMap(evidenceLoad.rows),
    batchMutationCount: input.plan.evidenceCreates.length + input.plan.evidenceUpdates.length,
  });
}

async function writePostWriteMismatchTrace(
  comparison: EvidenceFinalStateComparison,
): Promise<string> {
  await mkdir(TRACE_DIR, { recursive: true });
  const tracePath = path.join(TRACE_DIR, `post-write-parity-${Date.now()}.json`);
  await writeFile(
    tracePath,
    JSON.stringify(
      {
        parity: comparison.parity,
        seenCountParity: comparison.seenCountParity,
        lastSeenAtParity: comparison.lastSeenAtParity,
        agentRunParity: comparison.agentRunParity,
        differences: comparison.differences.slice(0, 50),
      },
      null,
      2,
    ),
  );
  return tracePath;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].filter(Boolean);
}
