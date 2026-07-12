import { fail, ok } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { isMockCandidatesEnabled } from "@/server/candidates/service";
import { resetMockCandidateStore } from "@/server/candidates/mockStore";

export async function POST(request: Request): Promise<Response> {
  try {
    const protection = protectApiRequest(request, {
      requireSameOrigin: true,
      maxBodyBytes: 256,
      rateLimit: { key: "mock-reset", limit: 10, windowMs: 60_000 },
    });
    if (protection) return protection;

    if (!isMockCandidatesEnabled()) {
      return fail(
        "MOCK_MODE_REQUIRED",
        "Mock store reset requires USE_MOCK_CANDIDATES=true in development.",
        400,
      );
    }
    resetMockCandidateStore();
    return ok({ reset: true });
  } catch (error) {
    return fail(
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "Failed to reset mock store",
      500,
    );
  }
}
