import {
  candidateIdSchema,
  fail,
  ok,
  validationError,
} from "@/server/api/envelope";
import { getCandidateRepository } from "@/server/candidates/service";
import { appendApprovedCandidate } from "@/server/sheets/appendApprovedCandidate";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { id } = await context.params;
    const parsedId = candidateIdSchema.safeParse(id);
    if (!parsedId.success) {
      return validationError(parsedId.error);
    }

    const repo = getCandidateRepository();
    const existing = await repo.getCandidate(parsedId.data);
    if (!existing) {
      return fail("CANDIDATE_NOT_FOUND", "Candidate not found", 404);
    }

    if (existing.status !== "APPROVED") {
      return fail(
        "VALIDATION_ERROR",
        `Candidate status is ${existing.status}, expected APPROVED`,
        400,
      );
    }

    const sheetSync = await appendApprovedCandidate(parsedId.data);
    const candidate = await repo.getCandidate(parsedId.data);

    return ok({
      candidate,
      sheetSync,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to sync candidate to sheet";
    return fail("INTERNAL_ERROR", message, 500);
  }
}
