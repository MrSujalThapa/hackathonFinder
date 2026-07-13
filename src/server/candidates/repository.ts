import type { CandidateStatus, Database } from "@/lib/supabase/database.types";
import { createServiceSupabaseClient } from "@/lib/supabase/createServiceClient";
import { normalizeEvidenceUrlKey } from "@/lib/http/evidenceUrl";
import type {
  AddActionInput,
  AddCandidateAnswerInput,
  AddEvidenceInput,
  CandidateCard,
  ListCandidatesParams,
  ListCandidatesResult,
  StatusChangeMetadata,
  UpsertCandidateInput,
  UpsertCandidateResult,
} from "@/core/candidates/types";
import {
  candidateRowFromUpsertInput,
  mapCandidateDetail,
  mapCandidateRow,
  mapEvidenceRow,
  mergeCandidateRows,
} from "@/server/candidates/mappers";

function decodeCursor(cursor: string): { score?: number; foundAt: string; id: string } {
  const parts = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (parts.length === 3) {
    const [scoreRaw, foundAt, id] = parts;
    const score = Number(scoreRaw);
    if (!Number.isFinite(score) || !foundAt || !id) {
      throw new Error("Invalid cursor.");
    }
    return { score, foundAt, id };
  }
  const [foundAt, id] = parts;
  if (!foundAt || !id) {
    throw new Error("Invalid cursor.");
  }
  return { foundAt, id };
}

function encodeCursor(row: { score: number; found_at: string; id: string }): string {
  return Buffer.from(`${row.score}|${row.found_at}|${row.id}`, "utf8").toString("base64url");
}

/** Columns required for CandidateCard mapping — avoids pulling description/fingerprint blobs. */
const CANDIDATE_CARD_SELECT = [
  "id",
  "status",
  "score",
  "name",
  "summary",
  "source",
  "official_url",
  "apply_url",
  "social_url",
  "start_date",
  "end_date",
  "deadline",
  "location",
  "mode",
  "city",
  "country",
  "prize",
  "themes",
  "eligibility",
  "why_match",
  "red_flags",
  "found_at",
  "last_verified",
  "approved_at",
  "sheet_row_id",
  "sheet_appended_at",
].join(",");

export async function listCandidates(
  params: ListCandidatesParams = {},
): Promise<ListCandidatesResult> {
  const supabase = createServiceSupabaseClient();
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
  const sort = params.sort ?? "score";

  let query = supabase
    .from("candidates")
    .select(CANDIDATE_CARD_SELECT, { count: "exact" });

  if (sort === "name") {
    query = query
      .order("name", { ascending: true })
      .order("id", { ascending: true });
  } else if (sort === "found_at") {
    query = query
      .order("found_at", { ascending: false })
      .order("id", { ascending: false });
  } else {
    query = query
      .order("score", { ascending: false })
      .order("found_at", { ascending: false })
      .order("id", { ascending: false });
  }

  query = query.limit(limit + 1);

  if (params.status) {
    query = query.eq("status", params.status);
  }

  if (params.statuses && params.statuses.length > 0) {
    query = query.in("status", params.statuses);
  }

  if (params.source) {
    query = query.eq("source", params.source);
  }

  if (params.q) {
    query = query.ilike("name", `%${params.q}%`);
  }

  if (params.offset != null && params.offset > 0) {
    query = query.range(params.offset, params.offset + limit);
  } else if (params.cursor) {
    const { score, foundAt, id } = decodeCursor(params.cursor);
    if (sort === "score" && typeof score === "number") {
      query = query.or(
        `score.lt.${score},and(score.eq.${score},found_at.lt.${foundAt}),and(score.eq.${score},found_at.eq.${foundAt},id.lt.${id})`,
      );
    } else {
      query = query.or(
        `found_at.lt.${foundAt},and(found_at.eq.${foundAt},id.lt.${id})`,
      );
    }
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to list candidates: ${error.message}`);
  }

  type CandidateRow = Database["public"]["Tables"]["candidates"]["Row"];
  const rows = (data ?? []) as unknown as CandidateRow[];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const candidates = pageRows.map(mapCandidateRow);
  const last = pageRows.at(-1);

  return {
    candidates,
    nextCursor:
      hasMore && last ? encodeCursor(last) : undefined,
    total: count ?? undefined,
  };
}

export async function getCandidate(id: string) {
  const supabase = createServiceSupabaseClient();

  const [
    { data: candidate, error: candidateError },
    { data: evidence, error: evidenceError },
    { data: answers, error: answersError },
    { data: actions, error: actionsError },
  ] = await Promise.all([
    supabase.from("candidates").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("candidate_evidence")
      .select("*")
      .eq("candidate_id", id)
      .order("found_at", { ascending: false }),
    supabase
      .from("candidate_answers")
      .select("*")
      .eq("candidate_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("candidate_actions")
      .select("*")
      .eq("candidate_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (candidateError) {
    throw new Error(`Failed to get candidate: ${candidateError.message}`);
  }
  if (evidenceError) {
    throw new Error(`Failed to get candidate evidence: ${evidenceError.message}`);
  }
  if (answersError) {
    throw new Error(`Failed to get candidate answers: ${answersError.message}`);
  }
  if (actionsError) {
    throw new Error(`Failed to get candidate actions: ${actionsError.message}`);
  }

  if (!candidate) {
    return null;
  }

  return mapCandidateDetail(
    candidate,
    evidence ?? [],
    answers ?? [],
    actions ?? [],
  );
}

export async function upsertCandidateByFingerprint(
  input: UpsertCandidateInput,
): Promise<UpsertCandidateResult> {
  const supabase = createServiceSupabaseClient();

  const { data: existing, error: lookupError } = await supabase
    .from("candidates")
    .select("*")
    .eq("fingerprint", input.fingerprint)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Failed to lookup candidate fingerprint: ${lookupError.message}`);
  }

  if (existing) {
    const updatePayload = mergeCandidateRows(existing, input);
    const { data: updated, error: updateError } = await supabase
      .from("candidates")
      .update(updatePayload)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (updateError) {
      throw new Error(`Failed to update duplicate candidate: ${updateError.message}`);
    }

    await addAction(existing.id, {
      action: "UPDATE_FROM_DUPLICATE",
      previousStatus: existing.status,
      newStatus: updated.status,
      metadata: {
        fingerprint: input.fingerprint,
        source: input.source,
      },
    });

    return {
      candidate: mapCandidateRow(updated),
      isNew: false,
    };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("candidates")
    .insert(candidateRowFromUpsertInput(input))
    .select("*")
    .single();

  if (insertError) {
    throw new Error(`Failed to insert candidate: ${insertError.message}`);
  }

  return {
    candidate: mapCandidateRow(inserted),
    isNew: true,
  };
}

export async function updateCandidateStatus(
  id: string,
  status: CandidateStatus,
  metadata: StatusChangeMetadata = {},
): Promise<CandidateCard> {
  const supabase = createServiceSupabaseClient();

  const { data: existing, error: lookupError } = await supabase
    .from("candidates")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Failed to load candidate for status update: ${lookupError.message}`);
  }
  if (!existing) {
    throw new Error(`Candidate not found: ${id}`);
  }

  // Idempotent: already in target status — return current row without duplicate action.
  if (existing.status === status) {
    return mapCandidateRow(existing);
  }

  const now = new Date().toISOString();
  const updatePayload: Database["public"]["Tables"]["candidates"]["Update"] = {
    status,
  };

  if (status === "APPROVED") {
    updatePayload.approved_at = now;
  } else if (status === "REJECTED") {
    updatePayload.rejected_at = now;
  } else if (status === "SAVED_FOR_LATER") {
    updatePayload.saved_at = now;
  } else if (status === "NEW") {
    // Restore clears decision timestamps so the card re-enters the queue cleanly.
    // Sheet row cleanup (clear sheet_row_id / sheet_appended_at) happens via
    // reconcileCandidateSheetState, not in updateCandidateStatus.
    updatePayload.approved_at = null;
    updatePayload.rejected_at = null;
    updatePayload.saved_at = null;
  }

  const { data: updated, error: updateError } = await supabase
    .from("candidates")
    .update(updatePayload)
    .eq("id", id)
    .select("*")
    .single();

  if (updateError) {
    throw new Error(`Failed to update candidate status: ${updateError.message}`);
  }

  const actionType = statusToActionType(status);
  if (actionType) {
    await addAction(id, {
      action: actionType,
      previousStatus: existing.status,
      newStatus: status,
      reason: metadata.reason,
      metadata: metadata.metadata ?? {},
    });
  }

  return mapCandidateRow(updated);
}

function statusToActionType(
  status: CandidateStatus,
): AddActionInput["action"] | null {
  switch (status) {
    case "APPROVED":
      return "APPROVE";
    case "REJECTED":
      return "REJECT";
    case "SAVED_FOR_LATER":
      return "SAVE_FOR_LATER";
    case "NEW":
      return "RESTORE";
    default:
      return null;
  }
}

/**
 * APPROVED candidates missing confirmed sheet sync metadata.
 * Queries at the DB layer so already-synced rows do not fill the page.
 */
export async function listPendingSheetSync(
  limit = 50,
): Promise<CandidateCard[]> {
  const supabase = createServiceSupabaseClient();
  const capped = Math.min(Math.max(limit, 1), 200);

  const { data, error } = await supabase
    .from("candidates")
    .select("*")
    .eq("status", "APPROVED")
    .or("sheet_row_id.is.null,sheet_appended_at.is.null")
    .order("found_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(capped);

  if (error) {
    throw new Error(`Failed to list pending sheet sync: ${error.message}`);
  }

  return (data ?? []).map(mapCandidateRow);
}

export async function updateSheetMetadata(
  id: string,
  meta: { sheetRowId: string; sheetAppendedAt?: string },
): Promise<CandidateCard> {
  const supabase = createServiceSupabaseClient();

  const sheetAppendedAt = meta.sheetAppendedAt ?? new Date().toISOString();

  const { data: updated, error } = await supabase
    .from("candidates")
    .update({
      sheet_row_id: meta.sheetRowId,
      sheet_appended_at: sheetAppendedAt,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to update sheet metadata: ${error.message}`);
  }

  return mapCandidateRow(updated);
}

export async function clearSheetMetadata(id: string): Promise<CandidateCard> {
  const supabase = createServiceSupabaseClient();

  const { data: updated, error } = await supabase
    .from("candidates")
    .update({
      sheet_row_id: null,
      sheet_appended_at: null,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to clear sheet metadata: ${error.message}`);
  }

  return mapCandidateRow(updated);
}

export async function addEvidence(candidateId: string, evidence: AddEvidenceInput) {
  const supabase = createServiceSupabaseClient();
  const now = evidence.foundAt ?? new Date().toISOString();
  const urlKey = normalizeEvidenceUrlKey(evidence.url);

  const { data: existing, error: lookupError } = await supabase
    .from("candidate_evidence")
    .select("*")
    .eq("candidate_id", candidateId)
    .eq("type", evidence.type)
    .eq("url_key", urlKey)
    .maybeSingle();

  if (lookupError) {
    // Pre-migration fallback: column may not exist yet — insert once.
    if (/url_key|first_seen|seen_count|agent_run/i.test(lookupError.message)) {
      const { data, error } = await supabase
        .from("candidate_evidence")
        .insert({
          candidate_id: candidateId,
          type: evidence.type,
          url: evidence.url ?? null,
          title: evidence.title ?? null,
          snippet: evidence.snippet ?? null,
          raw: evidence.raw ?? {},
          found_at: now,
        })
        .select("*")
        .single();
      if (error) {
        throw new Error(`Failed to add evidence: ${error.message}`);
      }
      return mapEvidenceRow(data);
    }
    throw new Error(`Failed to lookup evidence: ${lookupError.message}`);
  }

  if (existing) {
    const { data, error } = await supabase
      .from("candidate_evidence")
      .update({
        title: evidence.title ?? existing.title,
        snippet: evidence.snippet ?? existing.snippet,
        raw: evidence.raw ?? existing.raw,
        last_seen_at: now,
        seen_count: (existing.seen_count ?? 1) + 1,
        agent_run_id: evidence.agentRunId ?? existing.agent_run_id,
        url: evidence.url ?? existing.url,
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to update evidence: ${error.message}`);
    }
    return mapEvidenceRow(data);
  }

  const { data, error } = await supabase
    .from("candidate_evidence")
    .insert({
      candidate_id: candidateId,
      type: evidence.type,
      url: evidence.url ?? null,
      url_key: urlKey,
      title: evidence.title ?? null,
      snippet: evidence.snippet ?? null,
      raw: evidence.raw ?? {},
      found_at: now,
      first_seen_at: now,
      last_seen_at: now,
      seen_count: 1,
      agent_run_id: evidence.agentRunId ?? null,
    })
    .select("*")
    .single();

  if (error) {
    // Race: unique violation — re-fetch and bump
    if (/duplicate|unique/i.test(error.message)) {
      const { data: raced } = await supabase
        .from("candidate_evidence")
        .select("*")
        .eq("candidate_id", candidateId)
        .eq("type", evidence.type)
        .eq("url_key", urlKey)
        .maybeSingle();
      if (raced) {
        const { data: bumped, error: bumpError } = await supabase
          .from("candidate_evidence")
          .update({
            last_seen_at: now,
            seen_count: (raced.seen_count ?? 1) + 1,
            agent_run_id: evidence.agentRunId ?? raced.agent_run_id,
          })
          .eq("id", raced.id)
          .select("*")
          .single();
        if (bumpError) {
          throw new Error(`Failed to bump evidence: ${bumpError.message}`);
        }
        return mapEvidenceRow(bumped);
      }
    }
    throw new Error(`Failed to add evidence: ${error.message}`);
  }

  return mapEvidenceRow(data);
}

export async function addAction(candidateId: string, action: AddActionInput) {
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("candidate_actions")
    .insert({
      candidate_id: candidateId,
      action: action.action,
      previous_status: action.previousStatus ?? null,
      new_status: action.newStatus ?? null,
      reason: action.reason ?? null,
      metadata: action.metadata ?? {},
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to add candidate action: ${error.message}`);
  }

  return {
    id: data.id,
    candidateId: data.candidate_id,
    action: data.action,
    previousStatus: data.previous_status,
    newStatus: data.new_status,
    reason: data.reason,
    metadata: data.metadata,
    createdAt: data.created_at,
  };
}

export async function addCandidateAnswer(
  candidateId: string,
  answer: AddCandidateAnswerInput,
) {
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("candidate_answers")
    .insert({
      candidate_id: candidateId,
      question: answer.question,
      answer: answer.answer,
      confidence: answer.confidence ?? null,
      sources: answer.sources ?? [],
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to add candidate answer: ${error.message}`);
  }

  return {
    id: data.id,
    question: data.question,
    answer: data.answer,
    confidence: data.confidence,
    sources: data.sources,
    createdAt: data.created_at,
  };
}
