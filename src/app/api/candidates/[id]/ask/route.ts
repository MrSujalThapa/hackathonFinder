import { z } from "zod";
import {
  candidateIdSchema,
  fail,
  ok,
  validationError,
} from "@/server/api/envelope";
import {
  answerCandidateQuestion,
} from "@/core/candidateQuestionAnswer";
import { getCandidateRepository } from "@/server/candidates/service";
import { protectApiRequest } from "@/server/api/protection";
import { withRequestLogging } from "@/server/observability/logger";
import { createSearchProviderOptional } from "@/lib/search/createSearchProvider";

const askBodySchema = z.object({
  question: z.string().trim().min(1).max(500),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withRequestLogging(request, "POST /api/candidates/[id]/ask", async () => {
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

      const body = askBodySchema.safeParse(
        await request.json().catch(() => ({})),
      );
      if (!body.success) return validationError(body.error);

      const repo = getCandidateRepository();
      const candidate = await repo.getCandidate(parsedId.data);
      if (!candidate) {
        return fail("CANDIDATE_NOT_FOUND", "Candidate not found", 404);
      }

      const searchProvider = createSearchProviderOptional();
      const result = await answerCandidateQuestion(
        candidate,
        body.data.question,
        {
          searchProvider,
          maxSearchCalls: 1,
        },
      );

      const persisted = await repo.addCandidateAnswer?.(candidate.id, {
        question: body.data.question,
        answer: result.answer,
        confidence: result.confidence,
        sources: {
          links: result.sources,
          certainty: result.certainty,
          liveVerification: result.liveVerification,
        },
      });

      // Ask never mutates status or sheets — only re-read for answers list.
      const updatedCandidate = await repo.getCandidate(candidate.id);

      return ok({
        answer: result.answer,
        confidence: result.confidence,
        certainty: result.certainty,
        liveVerification: result.liveVerification,
        sources: result.sources,
        persistedAnswer: persisted ?? null,
        updatedCandidate: updatedCandidate ?? candidate,
      });
    } catch {
      return fail(
        "INTERNAL_ERROR",
        "Failed to answer candidate question",
        500,
      );
    }
  });
}
