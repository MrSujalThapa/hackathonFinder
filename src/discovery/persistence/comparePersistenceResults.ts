import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentRunSummary } from "@/core/discovery/types";
import type { PersistencePlan } from "@/discovery/persistence/persistencePlan";
import type { BatchPersistenceMetrics } from "@/discovery/persistence/batchPersistenceRepository";

export type PersistenceParity = "pass" | "fail";

export type PersistenceShadowSummary = {
  enabled: boolean;
  incomingCandidates: number;
  v1Creates: number;
  plannedCreates: number;
  v1Updates: number;
  plannedUpdates: number;
  plannedUnchanged: number;
  v1EvidenceWrites: number;
  plannedEvidenceWrites: number;
  plannedActions: number;
  candidateParity: PersistenceParity;
  candidateFieldParity: PersistenceParity;
  statusParity: PersistenceParity;
  evidenceParity: PersistenceParity;
  actionParity: PersistenceParity;
  batchWritesEnabled: false;
  estimatedBatchDatabaseCalls: number;
  timing: {
    candidateLookupMs: number;
    evidenceLookupMs: number;
    planningMs: number;
    totalMs: number;
  };
  metrics: BatchPersistenceMetrics;
  mismatchTracePath?: string;
};

export type PersistenceShadowMismatch = {
  area: "candidate" | "candidate-field" | "status" | "evidence" | "action";
  message: string;
  fingerprint?: string;
  evidenceKey?: string;
};

export type ComparePersistenceShadowInput = {
  plan: PersistencePlan;
  summary: Pick<AgentRunSummary, "created" | "updated" | "evidenceWritten">;
  metrics: BatchPersistenceMetrics;
  estimatedBatchDatabaseCalls: number;
  timing: PersistenceShadowSummary["timing"];
};

function parity(mismatches: PersistenceShadowMismatch[], area: PersistenceShadowMismatch["area"]): PersistenceParity {
  return mismatches.some((item) => item.area === area) ? "fail" : "pass";
}

export function comparePersistenceShadow(
  input: ComparePersistenceShadowInput,
): { summary: PersistenceShadowSummary; mismatches: PersistenceShadowMismatch[] } {
  const { plan, summary, metrics, estimatedBatchDatabaseCalls, timing } = input;
  const plannedEvidenceWrites = plan.evidenceCreates.length + plan.evidenceUpdates.length;
  const mismatches: PersistenceShadowMismatch[] = [];

  if (summary.created !== plan.candidateCreates.length) {
    mismatches.push({
      area: "candidate",
      message: `create count mismatch: V1=${summary.created} planned=${plan.candidateCreates.length}`,
    });
  }
  if (summary.updated !== plan.candidateUpdates.length) {
    mismatches.push({
      area: "candidate",
      message: `update count mismatch: V1=${summary.updated} planned=${plan.candidateUpdates.length}`,
    });
  }
  if (summary.evidenceWritten !== plannedEvidenceWrites) {
    mismatches.push({
      area: "evidence",
      message: `evidence write count mismatch: V1=${summary.evidenceWritten} planned=${plannedEvidenceWrites}`,
    });
  }
  for (const update of plan.candidateUpdates) {
    if ("status" in update.payload) {
      mismatches.push({
        area: "status",
        fingerprint: update.fingerprint,
        message: "candidate update payload includes status",
      });
    }
    if ("approved_at" in update.payload || "rejected_at" in update.payload || "saved_at" in update.payload) {
      mismatches.push({
        area: "status",
        fingerprint: update.fingerprint,
        message: "candidate update payload includes owner decision timestamp",
      });
    }
  }
  if (plan.actionsToCreate.length !== plan.candidateUpdates.length) {
    mismatches.push({
      area: "action",
      message: `action count mismatch: actions=${plan.actionsToCreate.length} candidate updates=${plan.candidateUpdates.length}`,
    });
  }

  return {
    mismatches,
    summary: {
      enabled: true,
      incomingCandidates: plan.diagnostics.incomingCandidates,
      v1Creates: summary.created,
      plannedCreates: plan.candidateCreates.length,
      v1Updates: summary.updated,
      plannedUpdates: plan.candidateUpdates.length,
      plannedUnchanged: plan.candidateUnchanged.length,
      v1EvidenceWrites: summary.evidenceWritten,
      plannedEvidenceWrites,
      plannedActions: plan.actionsToCreate.length,
      candidateParity: parity(mismatches, "candidate"),
      candidateFieldParity: parity(mismatches, "candidate-field"),
      statusParity: parity(mismatches, "status"),
      evidenceParity: parity(mismatches, "evidence"),
      actionParity: parity(mismatches, "action"),
      batchWritesEnabled: false,
      estimatedBatchDatabaseCalls,
      timing,
      metrics,
    },
  };
}

function line(label: string, value: string | number): string {
  return `  ${label.padEnd(28)}${String(value).padStart(8)}`;
}

export function formatPersistenceShadowSummary(summary: PersistenceShadowSummary): string[] {
  return [
    "[persistence-shadow]",
    line("incoming candidates", summary.incomingCandidates),
    line("V1 creates", summary.v1Creates),
    line("batch planned creates", summary.plannedCreates),
    line("V1 updates", summary.v1Updates),
    line("batch planned updates", summary.plannedUpdates),
    line("batch planned unchanged", summary.plannedUnchanged),
    line("V1 evidence writes", summary.v1EvidenceWrites),
    line("batch planned evidence", summary.plannedEvidenceWrites),
    line("batch planned actions", summary.plannedActions),
    line("candidate parity", summary.candidateParity),
    line("field parity", summary.candidateFieldParity),
    line("status parity", summary.statusParity),
    line("evidence parity", summary.evidenceParity),
    line("action parity", summary.actionParity),
    line("candidate lookup", `${summary.timing.candidateLookupMs}ms`),
    line("evidence lookup", `${summary.timing.evidenceLookupMs}ms`),
    line("planning", `${summary.timing.planningMs}ms`),
    line("shadow total", `${summary.timing.totalMs}ms`),
    line("estimated batch DB calls", summary.estimatedBatchDatabaseCalls),
    line("batch writes", "disabled"),
  ];
}

export async function writePersistenceShadowTrace(
  mismatches: PersistenceShadowMismatch[],
  summary: PersistenceShadowSummary,
  tracePath = ".local-audits/traces/phase-3a/persistence-shadow-mismatches.json",
): Promise<string | undefined> {
  if (mismatches.length === 0) return undefined;
  const absolute = path.resolve(tracePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(
    absolute,
    JSON.stringify(
      {
        summary,
        mismatches,
      },
      null,
      2,
    ),
  );
  return tracePath;
}
