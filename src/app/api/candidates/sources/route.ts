import { fail, ok } from "@/server/api/envelope";
import { getCandidateRepository } from "@/server/candidates/service";
import { withRequestLogging } from "@/server/observability/logger";

export async function GET(request: Request): Promise<Response> {
  return withRequestLogging(request, "GET /api/candidates/sources", async () => {
    try {
      const repo = getCandidateRepository();
      const sources = repo.listPendingSources
        ? await repo.listPendingSources()
        : [];
      return ok({ sources });
    } catch {
      return fail("INTERNAL_ERROR", "Failed to list pending candidate sources", 500);
    }
  });
}
