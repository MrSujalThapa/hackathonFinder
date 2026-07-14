import type { AddActionInput, AddEvidenceInput, UpsertCandidateInput } from "@/core/candidates/types";
import type { Database, Json } from "@/lib/supabase/database.types";
import { normalizeEvidenceUrlKey } from "@/lib/http/evidenceUrl";
import {
  candidateRowFromUpsertInput,
  mergeCandidateRows,
} from "@/server/candidates/mappers";

export type CandidateRow = Database["public"]["Tables"]["candidates"]["Row"];
export type CandidateInsert = Database["public"]["Tables"]["candidates"]["Insert"];
export type CandidateUpdatePayload = Database["public"]["Tables"]["candidates"]["Update"];
export type EvidenceRow = Database["public"]["Tables"]["candidate_evidence"]["Row"];
export type EvidenceInsert = Database["public"]["Tables"]["candidate_evidence"]["Insert"];
export type EvidenceUpdatePayload = Database["public"]["Tables"]["candidate_evidence"]["Update"];

export type IncomingCandidateWrite = {
  candidate: UpsertCandidateInput;
  evidence: AddEvidenceInput[];
};

export type CandidateIdentity = {
  fingerprint: string;
  id?: string;
};

export type CandidateCreate = {
  fingerprint: string;
  row: CandidateInsert;
  sourceInput: UpsertCandidateInput;
};

export type CandidateUpdate = {
  fingerprint: string;
  id: string;
  existing: CandidateRow;
  payload: CandidateUpdatePayload;
  sourceInput: UpsertCandidateInput;
};

export type EvidenceIdentity = {
  candidateFingerprint: string;
  candidateId?: string;
  type: AddEvidenceInput["type"];
  urlKey: string;
  id?: string;
};

export type EvidenceCreate = EvidenceIdentity & {
  row: EvidenceInsert;
  observationCount: number;
  seenCountIncrement: number;
};

export type EvidenceUpdate = EvidenceIdentity & {
  id: string;
  payload: EvidenceUpdatePayload;
  observationCount: number;
  seenCountIncrement: number;
};

export type CandidateActionCreate = {
  candidateFingerprint: string;
  candidateId: string;
  action: AddActionInput;
};

export type PersistencePlan = {
  candidateCreates: CandidateCreate[];
  candidateUpdates: CandidateUpdate[];
  candidateUnchanged: CandidateIdentity[];
  evidenceCreates: EvidenceCreate[];
  evidenceUpdates: EvidenceUpdate[];
  evidenceUnchanged: EvidenceIdentity[];
  actionsToCreate: CandidateActionCreate[];
  diagnostics: {
    incomingCandidates: number;
    uniqueFingerprints: number;
    duplicateIncomingCandidates: number;
    incomingEvidence: number;
    uniqueEvidence: number;
    duplicateEvidenceObservations: number;
  };
};

export type PlanPersistenceOptions = {
  now?: string;
};

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

function isMeaningful(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function mergeArrays(left: string[] | undefined, right: string[] | undefined): string[] | undefined {
  const values = [...(left ?? []), ...(right ?? [])].filter(Boolean);
  return values.length > 0 ? [...new Set(values)] : undefined;
}

function mergeSourceIds(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const merged = { ...(left ?? {}), ...(right ?? {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function prefer<T>(left: T | null | undefined, right: T | null | undefined): T | null | undefined {
  return isMeaningful(left) ? left : right;
}

function mergeIncomingCandidate(
  left: UpsertCandidateInput,
  right: UpsertCandidateInput,
): UpsertCandidateInput {
  return {
    fingerprint: left.fingerprint,
    name: String(prefer(left.name, right.name) ?? right.name),
    source: String(prefer(left.source, right.source) ?? right.source),
    status: left.status ?? right.status,
    score: right.score ?? left.score,
    officialUrl: prefer(left.officialUrl, right.officialUrl),
    applyUrl: prefer(left.applyUrl, right.applyUrl),
    socialUrl: prefer(left.socialUrl, right.socialUrl),
    startDate: prefer(left.startDate, right.startDate),
    endDate: prefer(left.endDate, right.endDate),
    deadline: prefer(left.deadline, right.deadline),
    location: prefer(left.location, right.location),
    mode: prefer(left.mode, right.mode),
    city: prefer(left.city, right.city),
    country: prefer(left.country, right.country),
    prize: prefer(left.prize, right.prize),
    themes: mergeArrays(left.themes, right.themes),
    eligibility: prefer(left.eligibility, right.eligibility),
    description: prefer(left.description, right.description),
    summary: prefer(left.summary, right.summary),
    whyMatch: mergeArrays(left.whyMatch, right.whyMatch),
    redFlags: mergeArrays(left.redFlags, right.redFlags),
    sourceIds: mergeSourceIds(left.sourceIds, right.sourceIds),
    foundAt: prefer(left.foundAt, right.foundAt) ?? undefined,
    lastVerified: right.lastVerified ?? left.lastVerified,
  };
}

function normalizeIncoming(writeSet: IncomingCandidateWrite[]): IncomingCandidateWrite[] {
  const byFingerprint = new Map<string, IncomingCandidateWrite>();
  const sorted = [...writeSet].sort((left, right) => {
    const fingerprintCmp = left.candidate.fingerprint.localeCompare(right.candidate.fingerprint);
    if (fingerprintCmp !== 0) return fingerprintCmp;
    return stableJson(left).localeCompare(stableJson(right));
  });

  for (const item of sorted) {
    const existing = byFingerprint.get(item.candidate.fingerprint);
    if (!existing) {
      byFingerprint.set(item.candidate.fingerprint, {
        candidate: { ...item.candidate },
        evidence: [...item.evidence],
      });
      continue;
    }
    byFingerprint.set(item.candidate.fingerprint, {
      candidate: mergeIncomingCandidate(existing.candidate, item.candidate),
      evidence: [...existing.evidence, ...item.evidence],
    });
  }

  return [...byFingerprint.values()].sort((left, right) =>
    left.candidate.fingerprint.localeCompare(right.candidate.fingerprint),
  );
}

function candidateUpdateChangesRow(
  existing: CandidateRow,
  payload: CandidateUpdatePayload,
): boolean {
  return Object.entries(payload).some(([key, value]) => {
    const existingValue = existing[key as keyof CandidateRow] as unknown;
    return stableJson(existingValue) !== stableJson(value);
  });
}

function evidenceKey(candidateId: string, type: string, urlKey: string): string {
  return `${candidateId}\u0000${type}\u0000${urlKey}`;
}

function evidenceInputToInsert(
  candidateId: string | undefined,
  evidence: AddEvidenceInput,
  now: string,
): EvidenceInsert {
  const foundAt = evidence.foundAt ?? now;
  return {
    candidate_id: candidateId ?? "__pending_candidate_id__",
    type: evidence.type,
    url: evidence.url ?? null,
    url_key: normalizeEvidenceUrlKey(evidence.url),
    title: evidence.title ?? null,
    snippet: evidence.snippet ?? null,
    raw: (evidence.raw ?? {}) as Json,
    found_at: foundAt,
    first_seen_at: foundAt,
    last_seen_at: foundAt,
    seen_count: 1,
    agent_run_id: evidence.agentRunId ?? null,
  };
}

function evidenceInputToUpdate(
  existing: EvidenceRow,
  evidence: AddEvidenceInput,
  now: string,
): EvidenceUpdatePayload {
  return {
    title: evidence.title ?? existing.title,
    snippet: evidence.snippet ?? existing.snippet,
    raw: evidence.raw ?? existing.raw,
    last_seen_at: evidence.foundAt ?? now,
    seen_count: (existing.seen_count ?? 1) + 1,
    agent_run_id: evidence.agentRunId ?? existing.agent_run_id,
    url: evidence.url ?? existing.url,
  };
}

function applyEvidenceObservationToInsert(
  row: EvidenceInsert,
  evidence: AddEvidenceInput,
  now: string,
): EvidenceInsert {
  return {
    ...row,
    title: evidence.title ?? row.title ?? null,
    snippet: evidence.snippet ?? row.snippet ?? null,
    raw: (evidence.raw ?? row.raw ?? {}) as Json,
    url: evidence.url ?? row.url ?? null,
    last_seen_at: evidence.foundAt ?? now,
    seen_count: (row.seen_count ?? 1) + 1,
    agent_run_id: evidence.agentRunId ?? row.agent_run_id ?? null,
  };
}

function applyEvidenceObservationToUpdate(
  payload: EvidenceUpdatePayload,
  evidence: AddEvidenceInput,
  now: string,
): EvidenceUpdatePayload {
  return {
    ...payload,
    title: evidence.title ?? payload.title ?? null,
    snippet: evidence.snippet ?? payload.snippet ?? null,
    raw: (evidence.raw ?? payload.raw ?? {}) as Json,
    url: evidence.url ?? payload.url ?? null,
    last_seen_at: evidence.foundAt ?? now,
    seen_count: (payload.seen_count ?? 1) + 1,
    agent_run_id: evidence.agentRunId ?? payload.agent_run_id ?? null,
  };
}

export function planPersistence(
  incomingWriteSet: IncomingCandidateWrite[],
  existingCandidates: CandidateRow[],
  existingEvidence: EvidenceRow[],
  options: PlanPersistenceOptions = {},
): PersistencePlan {
  const now = options.now ?? new Date().toISOString();
  const normalized = normalizeIncoming(incomingWriteSet);
  const existingByFingerprint = new Map(
    existingCandidates.map((candidate) => [candidate.fingerprint, candidate]),
  );
  const evidenceByIdentity = new Map(
    existingEvidence.map((evidence) => [
      evidenceKey(evidence.candidate_id, evidence.type, evidence.url_key),
      evidence,
    ]),
  );

  const candidateCreates: CandidateCreate[] = [];
  const candidateUpdates: CandidateUpdate[] = [];
  const candidateUnchanged: CandidateIdentity[] = [];
  const evidenceCreates: EvidenceCreate[] = [];
  const evidenceUpdates: EvidenceUpdate[] = [];
  const evidenceUnchanged: EvidenceIdentity[] = [];
  const actionsToCreate: CandidateActionCreate[] = [];
  let incomingEvidence = 0;
  const uniqueEvidenceKeys = new Set<string>();
  let duplicateEvidenceObservations = 0;

  for (const item of normalized) {
    const existing = existingByFingerprint.get(item.candidate.fingerprint);
    if (!existing) {
      candidateCreates.push({
        fingerprint: item.candidate.fingerprint,
        row: candidateRowFromUpsertInput(item.candidate),
        sourceInput: item.candidate,
      });
    } else {
      const payload = mergeCandidateRows(existing, item.candidate);
      if (candidateUpdateChangesRow(existing, payload)) {
        candidateUpdates.push({
          fingerprint: item.candidate.fingerprint,
          id: existing.id,
          existing,
          payload,
          sourceInput: item.candidate,
        });
        actionsToCreate.push({
          candidateFingerprint: item.candidate.fingerprint,
          candidateId: existing.id,
          action: {
            action: "UPDATE_FROM_DUPLICATE",
            previousStatus: existing.status,
            newStatus: existing.status,
            metadata: {
              fingerprint: item.candidate.fingerprint,
              source: item.candidate.source,
            },
          },
        });
      } else {
        candidateUnchanged.push({
          fingerprint: item.candidate.fingerprint,
          id: existing.id,
        });
      }
    }

    const candidateId = existing?.id;
    const plannedEvidenceByKey = new Map<
      string,
      { kind: "create"; value: EvidenceCreate } | { kind: "update"; value: EvidenceUpdate }
    >();
    for (const evidence of item.evidence) {
      incomingEvidence += 1;
      const urlKey = normalizeEvidenceUrlKey(evidence.url);
      const identity: EvidenceIdentity = {
        candidateFingerprint: item.candidate.fingerprint,
        candidateId,
        type: evidence.type,
        urlKey,
      };
      const uniqueKey = `${item.candidate.fingerprint}\u0000${evidence.type}\u0000${urlKey}`;
      const planned = plannedEvidenceByKey.get(uniqueKey);
      if (planned) {
        duplicateEvidenceObservations += 1;
        if (planned.kind === "create") {
          planned.value.row = applyEvidenceObservationToInsert(
            planned.value.row,
            evidence,
            now,
          );
          planned.value.observationCount += 1;
          planned.value.seenCountIncrement += 1;
        } else {
          planned.value.payload = applyEvidenceObservationToUpdate(
            planned.value.payload,
            evidence,
            now,
          );
          planned.value.observationCount += 1;
          planned.value.seenCountIncrement += 1;
        }
        continue;
      }
      uniqueEvidenceKeys.add(uniqueKey);

      const existingEvidenceRow = candidateId
        ? evidenceByIdentity.get(evidenceKey(candidateId, evidence.type, urlKey))
        : undefined;
      if (existingEvidenceRow) {
        const update: EvidenceUpdate = {
          ...identity,
          id: existingEvidenceRow.id,
          payload: evidenceInputToUpdate(existingEvidenceRow, evidence, now),
          observationCount: 1,
          seenCountIncrement: 1,
        };
        evidenceUpdates.push(update);
        plannedEvidenceByKey.set(uniqueKey, { kind: "update", value: update });
      } else {
        const create: EvidenceCreate = {
          ...identity,
          row: evidenceInputToInsert(candidateId, evidence, now),
          observationCount: 1,
          seenCountIncrement: 1,
        };
        evidenceCreates.push(create);
        plannedEvidenceByKey.set(uniqueKey, { kind: "create", value: create });
      }
    }
  }

  return {
    candidateCreates,
    candidateUpdates,
    candidateUnchanged,
    evidenceCreates,
    evidenceUpdates,
    evidenceUnchanged,
    actionsToCreate,
    diagnostics: {
      incomingCandidates: incomingWriteSet.length,
      uniqueFingerprints: normalized.length,
      duplicateIncomingCandidates: incomingWriteSet.length - normalized.length,
      incomingEvidence,
      uniqueEvidence: uniqueEvidenceKeys.size,
      duplicateEvidenceObservations,
    },
  };
}
