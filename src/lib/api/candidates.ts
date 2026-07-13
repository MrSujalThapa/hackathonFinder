import type { CandidateCard, CandidateDetail } from "@/core/candidates/types";
import type { ApiEnvelope } from "@/server/api/envelope";
import type {
  BatchSyncSummary,
  SheetSyncResult,
} from "@/server/sheets/types";
import { timedAsync } from "@/lib/perf/timing";

export class CandidatesApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "CandidatesApiError";
    this.code = code;
    this.status = status;
  }
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || body.error || body.data == null) {
    throw new CandidatesApiError(
      body.error?.message ?? `Request failed (${response.status})`,
      body.error?.code ?? "INTERNAL_ERROR",
      response.status,
    );
  }
  return body.data;
}

export type ListCandidatesResponse = {
  candidates: CandidateCard[];
  nextCursor: string | null;
  total: number | null;
};

export async function fetchCandidates(params: {
  status?: string;
  statuses?: string[];
  limit?: number;
  source?: string;
  q?: string;
  sort?: string;
  cursor?: string;
}): Promise<ListCandidatesResponse> {
  return timedAsync("client.list_fetch", async () => {
    const search = new URLSearchParams();
    if (params.status) search.set("status", params.status);
    if (params.statuses?.length) search.set("statuses", params.statuses.join(","));
    if (params.limit != null) search.set("limit", String(params.limit));
    if (params.source) search.set("source", params.source);
    if (params.q) search.set("q", params.q);
    if (params.sort) search.set("sort", params.sort);
    if (params.cursor) search.set("cursor", params.cursor);

    const response = await fetch(`/api/candidates?${search.toString()}`, {
      cache: "no-store",
    });
    return parseEnvelope<ListCandidatesResponse>(response);
  });
}

export async function fetchCandidate(id: string): Promise<CandidateDetail> {
  return timedAsync("client.detail_fetch", async () => {
    const response = await fetch(`/api/candidates/${id}`, { cache: "no-store" });
    const data = await parseEnvelope<{ candidate: CandidateDetail }>(response);
    return data.candidate;
  });
}

export type DecisionAction = "approve" | "reject" | "save" | "restore";

export type DecideCandidateResult = {
  candidate: CandidateCard;
  sheetSync?: SheetSyncResult | null;
};

export async function decideCandidate(
  id: string,
  action: DecisionAction,
  reason?: string,
): Promise<DecideCandidateResult> {
  return timedAsync(`client.status_api.${action}`, async () => {
    const response = await fetch(`/api/candidates/${id}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reason ? { reason } : {}),
    });
    const data = await parseEnvelope<{
      candidate: CandidateCard;
      sheetSync?: SheetSyncResult | null;
    }>(response);
    return {
      candidate: data.candidate,
      sheetSync: data.sheetSync ?? null,
    };
  });
}

export type SyncCandidateSheetResult = {
  candidate: CandidateDetail | CandidateCard | null;
  sheetSync: SheetSyncResult;
};

export async function syncCandidateSheet(
  id: string,
): Promise<SyncCandidateSheetResult> {
  return timedAsync("client.sheets_sync", async () => {
    const response = await fetch(`/api/candidates/${id}/sync-sheet`, {
      method: "POST",
    });
    return parseEnvelope<SyncCandidateSheetResult>(response);
  });
}

export async function syncApprovedSheets(
  limit?: number,
): Promise<BatchSyncSummary> {
  const response = await fetch("/api/sheets/sync-approved", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(limit != null ? { limit } : {}),
  });
  return parseEnvelope<BatchSyncSummary>(response);
}

export type AskCandidateResponse = {
  answer: string;
  confidence: "low" | "medium" | "high";
  certainty?: "confirmed" | "inferred" | "conflicting" | "unknown";
  liveVerification?: boolean;
  kind?: "factual" | "decision";
  decision?: {
    recommendation: "strong_yes" | "yes" | "maybe" | "no" | "strong_no";
    headline: string;
    reasons: string[];
    concerns: string[];
    missingInformation: string[];
    nextStep: string;
    confidence: "high" | "medium" | "low";
    citations: Array<{ url: string; label: string }>;
  } | null;
  sources: Array<{ url: string; label: string }>;
  updatedCandidate: CandidateDetail;
};

export async function askCandidate(
  id: string,
  question: string,
  signal?: AbortSignal,
): Promise<AskCandidateResponse> {
  const response = await fetch(`/api/candidates/${id}/ask`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
  });
  return parseEnvelope<AskCandidateResponse>(response);
}
