import type { CandidateCard, CandidateDetail } from "@/core/candidates/types";
import type { ApiEnvelope } from "@/server/api/envelope";

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
  limit?: number;
  source?: string;
  q?: string;
  sort?: string;
  cursor?: string;
}): Promise<ListCandidatesResponse> {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.limit != null) search.set("limit", String(params.limit));
  if (params.source) search.set("source", params.source);
  if (params.q) search.set("q", params.q);
  if (params.sort) search.set("sort", params.sort);
  if (params.cursor) search.set("cursor", params.cursor);

  const response = await fetch(`/api/candidates?${search.toString()}`, {
    cache: "no-store",
  });
  return parseEnvelope<ListCandidatesResponse>(response);
}

export async function fetchCandidate(id: string): Promise<CandidateDetail> {
  const response = await fetch(`/api/candidates/${id}`, { cache: "no-store" });
  const data = await parseEnvelope<{ candidate: CandidateDetail }>(response);
  return data.candidate;
}

export type DecisionAction = "approve" | "reject" | "save" | "restore";

export async function decideCandidate(
  id: string,
  action: DecisionAction,
  reason?: string,
): Promise<CandidateCard> {
  const response = await fetch(`/api/candidates/${id}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(reason ? { reason } : {}),
  });
  const data = await parseEnvelope<{ candidate: CandidateCard }>(response);
  return data.candidate;
}
