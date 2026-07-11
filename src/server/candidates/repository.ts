import type { CandidateStatus, Database } from "@/lib/supabase/database.types";
import { createServiceSupabaseClient } from "@/lib/supabase/createServiceClient";
import type {
  AddActionInput,
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

function decodeCursor(cursor: string): { foundAt: string; id: string } {
  const [foundAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (!foundAt || !id) {
    throw new Error("Invalid cursor.");
  }
  return { foundAt, id };
}

function encodeCursor(foundAt: string, id: string): string {
  return Buffer.from(`${foundAt}|${id}`, "utf8").toString("base64url");
}

export async function listCandidates(
  params: ListCandidatesParams = {},
): Promise<ListCandidatesResult> {
  const supabase = createServiceSupabaseClient();
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
  const sort = params.sort ?? "score";

  let query = supabase.from("candidates").select("*", { count: "exact" });

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

  if (params.source) {
    query = query.eq("source", params.source);
  }

  if (params.q) {
    query = query.ilike("name", `%${params.q}%`);
  }

  if (params.offset != null && params.offset > 0) {
    query = query.range(params.offset, params.offset + limit);
  } else if (params.cursor) {
    const { foundAt, id } = decodeCursor(params.cursor);
    query = query.or(
      `found_at.lt.${foundAt},and(found_at.eq.${foundAt},id.lt.${id})`,
    );
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to list candidates: ${error.message}`);
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const candidates = pageRows.map(mapCandidateRow);
  const last = pageRows.at(-1);

  return {
    candidates,
    nextCursor:
      hasMore && last ? encodeCursor(last.found_at, last.id) : undefined,
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
    // Do not clear sheet_row_id / sheet_appended_at — a prior sheet append still stands.
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

export async function addEvidence(candidateId: string, evidence: AddEvidenceInput) {
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("candidate_evidence")
    .insert({
      candidate_id: candidateId,
      type: evidence.type,
      url: evidence.url ?? null,
      title: evidence.title ?? null,
      snippet: evidence.snippet ?? null,
      raw: evidence.raw ?? {},
      found_at: evidence.foundAt,
    })
    .select("*")
    .single();

  if (error) {
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
