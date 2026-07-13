import type { Database, Json } from "@/lib/supabase/database.types";
import type {
  CandidateAction,
  CandidateCard,
  CandidateDetail,
  CandidateEvidence,
} from "@/core/candidates/types";

type CandidateRow = Database["public"]["Tables"]["candidates"]["Row"];
type EvidenceRow = Database["public"]["Tables"]["candidate_evidence"]["Row"];
type ActionRow = Database["public"]["Tables"]["candidate_actions"]["Row"];
type AnswerRow = Database["public"]["Tables"]["candidate_answers"]["Row"];

export function mapCandidateRow(row: CandidateRow): CandidateCard {
  return {
    id: row.id,
    status: row.status,
    score: row.score,
    name: row.name,
    summary: row.summary,
    source: row.source,
    sourceIds: (row.source_ids as Record<string, unknown>) ?? {},
    officialUrl: row.official_url,
    applyUrl: row.apply_url,
    socialUrl: row.social_url,
    startDate: row.start_date,
    endDate: row.end_date,
    deadline: row.deadline,
    location: row.location,
    mode: row.mode,
    city: row.city,
    country: row.country,
    prize: row.prize,
    themes: row.themes,
    eligibility: row.eligibility,
    whyMatch: row.why_match,
    redFlags: row.red_flags,
    foundAt: row.found_at,
    lastVerified: row.last_verified,
    approvedAt: row.approved_at,
    sheetRowId: row.sheet_row_id,
    sheetAppendedAt: row.sheet_appended_at,
  };
}

export function mapEvidenceRow(row: EvidenceRow): CandidateEvidence {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    type: row.type,
    url: row.url,
    title: row.title,
    snippet: row.snippet,
    raw: row.raw,
    foundAt: row.found_at,
    firstSeenAt: row.first_seen_at ?? row.found_at,
    lastSeenAt: row.last_seen_at ?? row.found_at,
    seenCount: row.seen_count ?? 1,
    agentRunId: row.agent_run_id ?? null,
  };
}

export function mapActionRow(row: ActionRow): CandidateAction {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    action: row.action,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    reason: row.reason,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

export function mapCandidateDetail(
  row: CandidateRow,
  evidence: EvidenceRow[],
  answers: AnswerRow[],
  actions: ActionRow[],
): CandidateDetail {
  return {
    ...mapCandidateRow(row),
    description: row.description,
    fingerprint: row.fingerprint,
    sourceIds: (row.source_ids as Record<string, unknown>) ?? {},
    evidence: evidence.map(mapEvidenceRow),
    answers: answers.map((answer) => ({
      id: answer.id,
      question: answer.question,
      answer: answer.answer,
      confidence: answer.confidence,
      sources: answer.sources,
      createdAt: answer.created_at,
    })),
    actions: actions.map(mapActionRow),
  };
}

export function mergeStringArrays(
  existing: string[] | undefined,
  incoming: string[] | undefined,
): string[] {
  const merged = new Set([...(existing ?? []), ...(incoming ?? [])]);
  return [...merged].filter(Boolean);
}

export function coalesceField<T>(existing: T | null | undefined, incoming: T | null | undefined): T | null | undefined {
  if (existing !== null && existing !== undefined && existing !== "") {
    // Prefer incoming ISO dates over weak existing text.
    if (
      typeof existing === "string" &&
      typeof incoming === "string" &&
      /^\d{4}-\d{2}-\d{2}/.test(incoming) &&
      !/^\d{4}-\d{2}-\d{2}/.test(existing)
    ) {
      return incoming;
    }
    return existing;
  }
  return incoming ?? existing;
}

export function mergeSourceIds(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return {
    ...existing,
    ...(incoming ?? {}),
  };
}

/** Prefer a live source over mock when merging duplicate fingerprints. */
export function mergeSourceField(existing: string, incoming: string): string {
  const next = incoming || existing;
  if (incoming === "mock" && existing && existing !== "mock") {
    return existing;
  }
  return next;
}

export function candidateRowFromUpsertInput(
  input: import("@/core/candidates/types").UpsertCandidateInput,
): Database["public"]["Tables"]["candidates"]["Insert"] {
  return {
    fingerprint: input.fingerprint,
    name: input.name,
    source: input.source,
    status: input.status ?? "NEW",
    score: input.score ?? 0,
    official_url: input.officialUrl ?? null,
    apply_url: input.applyUrl ?? null,
    social_url: input.socialUrl ?? null,
    start_date: input.startDate ?? null,
    end_date: input.endDate ?? null,
    deadline: input.deadline ?? null,
    location: input.location ?? null,
    mode: input.mode ?? null,
    city: input.city ?? null,
    country: input.country ?? null,
    prize: input.prize ?? null,
    themes: input.themes ?? [],
    eligibility: input.eligibility ?? null,
    description: input.description ?? null,
    summary: input.summary ?? null,
    why_match: input.whyMatch ?? [],
    red_flags: input.redFlags ?? [],
    source_ids: (input.sourceIds ?? {}) as Json,
    found_at: input.foundAt,
    last_verified: input.lastVerified,
  };
}

export function mergeCandidateRows(
  existing: CandidateRow,
  incoming: import("@/core/candidates/types").UpsertCandidateInput,
): Database["public"]["Tables"]["candidates"]["Update"] {
  return {
    name: incoming.name || existing.name,
    source: mergeSourceField(existing.source, incoming.source),
    score: incoming.score ?? existing.score,
    official_url: coalesceField(existing.official_url, incoming.officialUrl),
    apply_url: coalesceField(existing.apply_url, incoming.applyUrl),
    social_url: coalesceField(existing.social_url, incoming.socialUrl),
    start_date: coalesceField(existing.start_date, incoming.startDate),
    end_date: coalesceField(existing.end_date, incoming.endDate),
    deadline: coalesceField(existing.deadline, incoming.deadline),
    location: coalesceField(existing.location, incoming.location),
    mode: coalesceField(existing.mode, incoming.mode),
    city: coalesceField(existing.city, incoming.city),
    country: coalesceField(existing.country, incoming.country),
    prize: coalesceField(existing.prize, incoming.prize),
    themes: mergeStringArrays(existing.themes, incoming.themes),
    eligibility: coalesceField(existing.eligibility, incoming.eligibility),
    description: coalesceField(existing.description, incoming.description),
    summary: coalesceField(existing.summary, incoming.summary),
    why_match: mergeStringArrays(existing.why_match, incoming.whyMatch),
    red_flags: mergeStringArrays(existing.red_flags, incoming.redFlags),
    source_ids: mergeSourceIds(
      (existing.source_ids as Record<string, unknown>) ?? {},
      incoming.sourceIds,
    ) as Json,
    last_verified: incoming.lastVerified ?? new Date().toISOString(),
  };
}
