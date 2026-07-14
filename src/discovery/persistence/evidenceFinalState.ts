import { createHash } from "node:crypto";
import type { AddEvidenceInput } from "@/core/candidates/types";
import type {
  CandidateRow,
  EvidenceCreate,
  EvidenceRow,
  EvidenceUpdate,
  IncomingCandidateWrite,
  PersistencePlan,
} from "@/discovery/persistence/persistencePlan";
import { normalizeEvidenceUrlKey } from "@/lib/http/evidenceUrl";
import type { Json } from "@/lib/supabase/database.types";

export type SimulatedEvidenceState = {
  identity: {
    candidateRef: string;
    type: AddEvidenceInput["type"];
    urlKey: string;
  };
  row: {
    candidateId: string;
    type: AddEvidenceInput["type"];
    url: string | null;
    urlKey: string;
    title: string | null;
    snippet: string | null;
    raw: Json;
    foundAt: string;
    firstSeenAt: string;
    lastSeenAt: string;
    seenCount: number;
    agentRunId: string | null;
  };
};

export type EvidenceFinalStateDiff = {
  identityHash: string;
  field: string;
  expected: string | number | null;
  actual: string | number | null;
};

export type EvidenceFinalStateComparison = {
  parity: "pass" | "fail";
  seenCountParity: "pass" | "fail";
  lastSeenAtParity: "pass" | "fail";
  agentRunParity: "pass" | "fail";
  v1OperationCount: number;
  v1DistinctIdentities: number;
  batchMutationCount: number;
  duplicateObservationCount: number;
  duplicateIdentityHashes: string[];
  differences: EvidenceFinalStateDiff[];
};

function stateKey(candidateRef: string, type: string, urlKey: string): string {
  return `${candidateRef}\u0000${type}\u0000${urlKey}`;
}

export function hashEvidenceIdentity(candidateRef: string, type: string, urlKey: string): string {
  return createHash("sha256")
    .update(stateKey(candidateRef, type, urlKey))
    .digest("hex")
    .slice(0, 16);
}

function rowToState(row: EvidenceRow): SimulatedEvidenceState {
  return {
    identity: {
      candidateRef: row.candidate_id,
      type: row.type,
      urlKey: row.url_key,
    },
    row: {
      candidateId: row.candidate_id,
      type: row.type,
      url: row.url,
      urlKey: row.url_key,
      title: row.title,
      snippet: row.snippet,
      raw: row.raw,
      foundAt: normalizeTimestamp(row.found_at),
      firstSeenAt: normalizeTimestamp(row.first_seen_at ?? row.found_at),
      lastSeenAt: normalizeTimestamp(row.last_seen_at ?? row.found_at),
      seenCount: row.seen_count ?? 1,
      agentRunId: row.agent_run_id ?? null,
    },
  };
}

function normalizeTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function applyObservation(
  state: SimulatedEvidenceState,
  evidence: AddEvidenceInput,
  now: string,
): SimulatedEvidenceState {
  return {
    identity: state.identity,
    row: {
      ...state.row,
      title: evidence.title ?? state.row.title,
      snippet: evidence.snippet ?? state.row.snippet,
      raw: evidence.raw ?? state.row.raw,
      url: evidence.url ?? state.row.url,
      lastSeenAt: evidence.foundAt ?? now,
      seenCount: state.row.seenCount + 1,
      agentRunId: evidence.agentRunId ?? state.row.agentRunId,
    },
  };
}

function insertObservation(
  candidateRef: string,
  evidence: AddEvidenceInput,
  now: string,
): SimulatedEvidenceState {
  const foundAt = evidence.foundAt ?? now;
  const urlKey = normalizeEvidenceUrlKey(evidence.url);
  return {
    identity: {
      candidateRef,
      type: evidence.type,
      urlKey,
    },
    row: {
      candidateId: candidateRef,
      type: evidence.type,
      url: evidence.url ?? null,
      urlKey,
      title: evidence.title ?? null,
      snippet: evidence.snippet ?? null,
      raw: (evidence.raw ?? {}) as Json,
      foundAt,
      firstSeenAt: foundAt,
      lastSeenAt: foundAt,
      seenCount: 1,
      agentRunId: evidence.agentRunId ?? null,
    },
  };
}

export function simulateV1EvidenceFinalState(
  writeSet: IncomingCandidateWrite[],
  existingCandidates: CandidateRow[],
  existingEvidence: EvidenceRow[],
  options: { now: string },
): {
  states: Map<string, SimulatedEvidenceState>;
  operationCount: number;
  distinctObservedIdentityCount: number;
  duplicateObservationCount: number;
  duplicateIdentityHashes: string[];
} {
  const existingByFingerprint = new Map(
    existingCandidates.map((candidate) => [candidate.fingerprint, candidate]),
  );
  const states = new Map<string, SimulatedEvidenceState>();
  for (const row of existingEvidence) {
    const state = rowToState(row);
    states.set(stateKey(state.identity.candidateRef, state.identity.type, state.identity.urlKey), state);
  }

  let operationCount = 0;
  const observedCounts = new Map<string, number>();

  for (const item of writeSet) {
    const candidateRef =
      existingByFingerprint.get(item.candidate.fingerprint)?.id ?? item.candidate.fingerprint;
    for (const evidence of item.evidence) {
      operationCount += 1;
      const urlKey = normalizeEvidenceUrlKey(evidence.url);
      const key = stateKey(candidateRef, evidence.type, urlKey);
      observedCounts.set(key, (observedCounts.get(key) ?? 0) + 1);
      const existing = states.get(key);
      states.set(
        key,
        existing
          ? applyObservation(existing, evidence, options.now)
          : insertObservation(candidateRef, evidence, options.now),
      );
    }
  }

  return {
    states,
    operationCount,
    distinctObservedIdentityCount: observedCounts.size,
    duplicateObservationCount: [...observedCounts.values()].reduce(
      (total, count) => total + Math.max(0, count - 1),
      0,
    ),
    duplicateIdentityHashes: [...observedCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => {
        const [candidateRef, type, urlKey] = key.split("\u0000");
        return hashEvidenceIdentity(candidateRef ?? "", type ?? "", urlKey ?? "");
      })
      .sort(),
  };
}

function applyCreate(state: EvidenceCreate): SimulatedEvidenceState {
  const candidateRef = state.candidateId ?? state.candidateFingerprint;
  return {
    identity: {
      candidateRef,
      type: state.type,
      urlKey: state.urlKey,
    },
    row: {
      candidateId: candidateRef,
      type: state.type,
      url: state.row.url ?? null,
      urlKey: state.urlKey,
      title: state.row.title ?? null,
      snippet: state.row.snippet ?? null,
      raw: state.row.raw ?? {},
      foundAt: state.row.found_at ?? "",
      firstSeenAt: state.row.first_seen_at ?? state.row.found_at ?? "",
      lastSeenAt: state.row.last_seen_at ?? state.row.found_at ?? "",
      seenCount: state.row.seen_count ?? 1,
      agentRunId: state.row.agent_run_id ?? null,
    },
  };
}

function applyUpdate(
  existing: SimulatedEvidenceState,
  update: EvidenceUpdate,
): SimulatedEvidenceState {
  return {
    identity: existing.identity,
    row: {
      ...existing.row,
      url: update.payload.url ?? existing.row.url,
      title: update.payload.title ?? existing.row.title,
      snippet: update.payload.snippet ?? existing.row.snippet,
      raw: update.payload.raw ?? existing.row.raw,
      lastSeenAt: update.payload.last_seen_at ?? existing.row.lastSeenAt,
      seenCount: update.payload.seen_count ?? existing.row.seenCount,
      agentRunId: update.payload.agent_run_id ?? existing.row.agentRunId,
    },
  };
}

export function simulateBatchEvidenceFinalState(
  plan: PersistencePlan,
  existingEvidence: EvidenceRow[],
): Map<string, SimulatedEvidenceState> {
  const states = new Map<string, SimulatedEvidenceState>();
  for (const row of existingEvidence) {
    const state = rowToState(row);
    states.set(stateKey(state.identity.candidateRef, state.identity.type, state.identity.urlKey), state);
  }
  for (const create of plan.evidenceCreates) {
    const state = applyCreate(create);
    states.set(stateKey(state.identity.candidateRef, state.identity.type, state.identity.urlKey), state);
  }
  for (const update of plan.evidenceUpdates) {
    const candidateRef = update.candidateId ?? update.candidateFingerprint;
    const key = stateKey(candidateRef, update.type, update.urlKey);
    const existing = states.get(key);
    if (existing) {
      states.set(key, applyUpdate(existing, update));
    }
  }
  return states;
}

export function evidenceRowsToStateMap(
  rows: EvidenceRow[],
): Map<string, SimulatedEvidenceState> {
  const states = new Map<string, SimulatedEvidenceState>();
  for (const row of rows) {
    const state = rowToState(row);
    states.set(stateKey(state.identity.candidateRef, state.identity.type, state.identity.urlKey), state);
  }
  return states;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function pushDiff(
  differences: EvidenceFinalStateDiff[],
  identityHash: string,
  field: string,
  expected: string | number | null,
  actual: string | number | null,
): void {
  if (expected !== actual) {
    differences.push({ identityHash, field, expected, actual });
  }
}

export function compareEvidenceFinalStates(input: {
  v1: ReturnType<typeof simulateV1EvidenceFinalState>;
  batch: Map<string, SimulatedEvidenceState>;
  batchMutationCount: number;
}): EvidenceFinalStateComparison {
  const differences: EvidenceFinalStateDiff[] = [];
  const keys = new Set([...input.v1.states.keys(), ...input.batch.keys()]);

  for (const key of keys) {
    const v1 = input.v1.states.get(key);
    const batch = input.batch.get(key);
    const [candidateRef, type, urlKey] = key.split("\u0000");
    const identityHash = hashEvidenceIdentity(candidateRef ?? "", type ?? "", urlKey ?? "");
    if (!v1 || !batch) {
      differences.push({
        identityHash,
        field: "existence",
        expected: v1 ? "present" : "missing",
        actual: batch ? "present" : "missing",
      });
      continue;
    }
    pushDiff(differences, identityHash, "candidateId", v1.row.candidateId, batch.row.candidateId);
    pushDiff(differences, identityHash, "type", v1.row.type, batch.row.type);
    pushDiff(differences, identityHash, "urlKey", v1.row.urlKey, batch.row.urlKey);
    pushDiff(differences, identityHash, "url", v1.row.url, batch.row.url);
    pushDiff(differences, identityHash, "title", v1.row.title, batch.row.title);
    pushDiff(differences, identityHash, "snippet", v1.row.snippet, batch.row.snippet);
    pushDiff(differences, identityHash, "raw", stableJson(v1.row.raw), stableJson(batch.row.raw));
    pushDiff(differences, identityHash, "firstSeenAt", v1.row.firstSeenAt, batch.row.firstSeenAt);
    pushDiff(differences, identityHash, "lastSeenAt", v1.row.lastSeenAt, batch.row.lastSeenAt);
    pushDiff(differences, identityHash, "seenCount", v1.row.seenCount, batch.row.seenCount);
    pushDiff(differences, identityHash, "agentRunId", v1.row.agentRunId, batch.row.agentRunId);
  }

  const seenCountParity = differences.some((diff) => diff.field === "seenCount")
    ? "fail"
    : "pass";
  const lastSeenAtParity = differences.some((diff) => diff.field === "lastSeenAt")
    ? "fail"
    : "pass";
  const agentRunParity = differences.some((diff) => diff.field === "agentRunId")
    ? "fail"
    : "pass";

  return {
    parity: differences.length === 0 ? "pass" : "fail",
    seenCountParity,
    lastSeenAtParity,
    agentRunParity,
    v1OperationCount: input.v1.operationCount,
    v1DistinctIdentities: input.v1.distinctObservedIdentityCount,
    batchMutationCount: input.batchMutationCount,
    duplicateObservationCount: input.v1.duplicateObservationCount,
    duplicateIdentityHashes: input.v1.duplicateIdentityHashes,
    differences,
  };
}
