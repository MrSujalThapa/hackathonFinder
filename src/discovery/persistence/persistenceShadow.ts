import type { AcceptedCandidate } from "@/core/discovery/types";
import { verifyHackathonEvent } from "@/core/verify";
import {
  eventEvidenceToAddInput,
  eventToUpsertInput,
} from "@/agent/summary";
import {
  createBatchPersistenceRepository,
  type BatchPersistenceMetrics,
  type BatchPersistenceRepository,
} from "@/discovery/persistence/batchPersistenceRepository";
import {
  planPersistence,
  type IncomingCandidateWrite,
  type PersistencePlan,
} from "@/discovery/persistence/persistencePlan";
import {
  comparePersistenceShadow,
  writePersistenceShadowTrace,
  type PersistenceShadowSummary,
} from "@/discovery/persistence/comparePersistenceResults";
import type { AgentRunSummary } from "@/core/discovery/types";
import { performance } from "node:perf_hooks";
import {
  compareEvidenceFinalStates,
  simulateBatchEvidenceFinalState,
  simulateV1EvidenceFinalState,
  type EvidenceFinalStateComparison,
} from "@/discovery/persistence/evidenceFinalState";

export type PersistenceShadowState = {
  plan: PersistencePlan;
  metrics: BatchPersistenceMetrics;
  estimatedBatchDatabaseCalls: number;
  timing: PersistenceShadowSummary["timing"];
  evidenceFinalState: EvidenceFinalStateComparison;
};

export function isPersistenceBatchShadowEnabled(): boolean {
  return process.env.PERSISTENCE_BATCH_SHADOW === "true";
}

function emptyMetrics(): BatchPersistenceMetrics {
  return {
    databaseCalls: 0,
    chunks: {},
    retries: 0,
    splitBatches: 0,
  };
}

export function acceptedCandidatesToWriteSet(
  accepted: AcceptedCandidate[],
  options: { now: Date; agentRunId?: string | null },
): IncomingCandidateWrite[] {
  return accepted.map((item) => {
    const verification = verifyHackathonEvent(item.event, { now: options.now });
    const candidate = eventToUpsertInput(item.event, item.score, verification, item.status);
    item.fingerprint = candidate.fingerprint;
    return {
      candidate,
      evidence: item.event.evidence.map((evidence) => ({
        ...eventEvidenceToAddInput(evidence),
        agentRunId: options.agentRunId ?? null,
      })),
    };
  });
}

export async function preparePersistenceShadow(
  accepted: AcceptedCandidate[],
  options: {
    now: Date;
    agentRunId?: string | null;
    repository?: BatchPersistenceRepository;
  },
): Promise<PersistenceShadowState> {
  const repository = options.repository ?? createBatchPersistenceRepository();
  const totalStartedAt = performance.now();
  const metrics = emptyMetrics();
  const writeSet = acceptedCandidatesToWriteSet(accepted, {
    now: options.now,
    agentRunId: options.agentRunId,
  });
  const fingerprints = writeSet.map((item) => item.candidate.fingerprint);
  const candidateLookupStartedAt = performance.now();
  const candidateLoad = await repository.fetchCandidatesByFingerprints(fingerprints, metrics);
  const candidateLookupMs = Math.round(performance.now() - candidateLookupStartedAt);
  const existingCandidateIds = candidateLoad.rows.map((candidate) => candidate.id);
  const evidenceLookupStartedAt = performance.now();
  const evidenceLoad = await repository.fetchEvidenceByCandidateIds(existingCandidateIds, candidateLoad.metrics);
  const evidenceLookupMs = Math.round(performance.now() - evidenceLookupStartedAt);
  const planningStartedAt = performance.now();
  const plan = planPersistence(writeSet, candidateLoad.rows, evidenceLoad.rows, {
    now: options.now.toISOString(),
  });
  const v1Evidence = simulateV1EvidenceFinalState(
    writeSet,
    candidateLoad.rows,
    evidenceLoad.rows,
    { now: options.now.toISOString() },
  );
  const batchEvidence = simulateBatchEvidenceFinalState(plan, evidenceLoad.rows);
  const evidenceFinalState = compareEvidenceFinalStates({
    v1: v1Evidence,
    batch: batchEvidence,
    batchMutationCount: plan.evidenceCreates.length + plan.evidenceUpdates.length,
  });
  const planningMs = Math.round(performance.now() - planningStartedAt);
  return {
    plan,
    metrics: evidenceLoad.metrics,
    estimatedBatchDatabaseCalls:
      evidenceLoad.metrics.databaseCalls + repository.estimateWriteCalls(plan),
    evidenceFinalState,
    timing: {
      candidateLookupMs,
      evidenceLookupMs,
      planningMs,
      totalMs: Math.round(performance.now() - totalStartedAt),
    },
  };
}

export async function finalizePersistenceShadow(
  state: PersistenceShadowState,
  summary: Pick<AgentRunSummary, "created" | "updated" | "evidenceWritten">,
): Promise<PersistenceShadowSummary> {
  const comparison = comparePersistenceShadow({
    plan: state.plan,
    summary,
    metrics: state.metrics,
    estimatedBatchDatabaseCalls: state.estimatedBatchDatabaseCalls,
    timing: state.timing,
    evidenceFinalState: state.evidenceFinalState,
  });
  const mismatchTracePath = await writePersistenceShadowTrace(
    comparison.mismatches,
    comparison.summary,
  );
  return mismatchTracePath
    ? { ...comparison.summary, mismatchTracePath }
    : comparison.summary;
}
