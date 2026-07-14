import {
  fail,
  listCandidatesQuerySchema,
  ok,
  validationError,
} from "@/server/api/envelope";
import { getCandidateRepository } from "@/server/candidates/service";
import {
  logServerEvent,
  safeError,
  withRequestLogging,
} from "@/server/observability/logger";

function classifyCandidateQueryError(error: unknown): {
  status: 400 | 500 | 504;
  message: string;
} {
  const safe = safeError(error);
  if (/invalid cursor/i.test(safe.message)) {
    return { status: 400, message: "Invalid cursor" };
  }
  if (/timeout|timed out/i.test(safe.message)) {
    return { status: 504, message: "Candidate query timed out" };
  }
  return {
    status: 500,
    message: "Candidate query failed. Check server logs with the request id.",
  };
}

function errorField(error: unknown, field: "dbCode" | "dbMessage"): string | null {
  if (!error || typeof error !== "object" || !(field in error)) return null;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

export async function GET(request: Request): Promise<Response> {
  return withRequestLogging(request, "GET /api/candidates", async (requestId) => {
    const url = new URL(request.url);
    const parsed = listCandidatesQuerySchema.safeParse(
      Object.fromEntries(url.searchParams.entries()),
    );

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const queryContext = {
      requestId,
      statuses: parsed.data.statuses?.join(",") ?? parsed.data.status ?? null,
      source: parsed.data.source ?? null,
      limit: parsed.data.limit,
      cursor: parsed.data.cursor ? "present" : "absent",
      sort: parsed.data.sort,
      requestPurpose: parsed.data.requestPurpose ?? null,
      queryMode: parsed.data.cursor
        ? "cursor"
        : parsed.data.offset != null
          ? "offset"
          : "initial",
      sourceFilterPresent: Boolean(parsed.data.source),
      cursorPresent: Boolean(parsed.data.cursor),
    };

    if (process.env.NODE_ENV !== "production") {
      logServerEvent("info", "candidates.request", queryContext);
    }

    try {
      const repo = getCandidateRepository();
      const result = await repo.listCandidates({
        status: parsed.data.status,
        statuses: parsed.data.statuses,
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
      const safe = safeError(error);
      const classified = classifyCandidateQueryError(error);
      logServerEvent("error", "candidates.query_failed", {
        ...queryContext,
        dbCode: errorField(error, "dbCode"),
        dbMessage: errorField(error, "dbMessage"),
        errorCategory: safe.category,
        errorMessage: safe.message,
      });

      return fail(
        classified.status === 400 ? "VALIDATION_ERROR" : "CANDIDATE_QUERY_FAILED",
        classified.message,
        classified.status,
        { requestId },
      );
    }
  });
}
