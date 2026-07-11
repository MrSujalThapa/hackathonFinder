import {
  candidateIdSchema,
  fail,
  listCandidatesQuerySchema,
  ok,
  validationError,
} from "@/server/api/envelope";
import { getCandidateRepository } from "@/server/candidates/service";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const parsed = listCandidatesQuerySchema.safeParse(
      Object.fromEntries(url.searchParams.entries()),
    );

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const repo = getCandidateRepository();
    const result = await repo.listCandidates({
      status: parsed.data.status,
      limit: parsed.data.limit,
      cursor: parsed.data.cursor,
      offset: parsed.data.offset,
      source: parsed.data.source,
      sort: parsed.data.sort,
      q: parsed.data.q,
    });

    return ok({
      candidates: result.candidates,
      nextCursor: result.nextCursor ?? null,
      total: result.total ?? null,
    });
  } catch (error) {
    return fail(
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "Failed to list candidates",
      500,
    );
  }
}
