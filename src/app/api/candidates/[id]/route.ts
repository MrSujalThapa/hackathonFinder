import {
  candidateIdSchema,
  fail,
  ok,
  validationError,
} from "@/server/api/envelope";
import { getCandidateRepository } from "@/server/candidates/service";
import { withRequestLogging } from "@/server/observability/logger";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withRequestLogging(request, "GET /api/candidates/[id]", async () => {
  try {
    const { id } = await context.params;
    const parsedId = candidateIdSchema.safeParse(id);
    if (!parsedId.success) {
      return validationError(parsedId.error);
    }

    const repo = getCandidateRepository();
    const candidate = await repo.getCandidate(parsedId.data);
    if (!candidate) {
      return fail("CANDIDATE_NOT_FOUND", "Candidate not found", 404);
    }

    return ok({ candidate });
  } catch {
    return fail(
      "INTERNAL_ERROR",
      "Failed to load candidate",
      500,
    );
  }
  });
}
