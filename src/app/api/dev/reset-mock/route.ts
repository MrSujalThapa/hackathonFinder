import { fail, ok } from "@/server/api/envelope";
import { isMockCandidatesEnabled } from "@/server/candidates/service";
import { resetMockCandidateStore } from "@/server/candidates/mockStore";

export async function POST(): Promise<Response> {
  try {
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
