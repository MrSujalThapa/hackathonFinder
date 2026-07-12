import { z } from "zod";
import {
  candidateIdSchema,
  fail,
  ok,
  validationError,
} from "@/server/api/envelope";
import { answerCandidateQuestion } from "@/core/candidateQuestionAnswer";
import { getCandidateRepository } from "@/server/candidates/service";
import { protectApiRequest } from "@/server/api/protection";

const askBodySchema = z.object({
  question: z.string().trim().min(3).max(500),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const protection = protectApiRequest(request, {
      requireSameOrigin: true,
      maxBodyBytes: 2_048,
      rateLimit: { key: "candidate-ask", limit: 10, windowMs: 60_000 },
    });
    if (protection) return protection;

    const { id } = await context.params;
    const parsedId = candidateIdSchema.safeParse(id);
    if (!parsedId.success) return validationError(parsedId.error);

    const body = askBodySchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return validationError(body.error);

    const repo = getCandidateRepository();
    const candidate = await repo.getCandidate(parsedId.data);
    if (!candidate) {
      return fail("CANDIDATE_NOT_FOUND", "Candidate not found", 404);
    }

    const result = answerCandidateQuestion(candidate, body.data.question);
    const persisted = await repo.addCandidateAnswer?.(candidate.id, {
      question: body.data.question,
      answer: result.answer,
      confidence: result.confidence,
      sources: result.sources,
    });

    const updatedCandidate = await repo.getCandidate(candidate.id);

    return ok({
      answer: result.answer,
      confidence: result.confidence,
      sources: result.sources,
      persistedAnswer: persisted ?? null,
      updatedCandidate: updatedCandidate ?? candidate,
    });
  } catch (error) {
    return fail(
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "Failed to answer candidate question",
      500,
    );
  }
}
