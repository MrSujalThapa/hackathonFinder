import { candidateIdSchema, fail, ok, validationError } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { withRequestLogging } from "@/server/observability/logger";
import { getDiscoveryJobStore } from "@/jobs/store";
import { requireOwnerSession } from "@/app/api/discovery/_auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withRequestLogging(request, "GET /api/discovery/jobs/[id]", async () => {
    const auth = await requireOwnerSession(request);
    if (auth) return auth;

    const protection = protectApiRequest(request, {
      rateLimit: { key: "discovery-job-get", limit: 120, windowMs: 60_000 },
    });
    if (protection) return protection;

    const { id } = await context.params;
    const parsedId = candidateIdSchema.safeParse(id);
    if (!parsedId.success) return validationError(parsedId.error);

    try {
      const job = await getDiscoveryJobStore().getJob(parsedId.data);
      if (!job) return fail("CANDIDATE_NOT_FOUND", "Discovery job not found", 404);
      return ok({ job });
    } catch (error) {
      return fail(
        "INTERNAL_ERROR",
        error instanceof Error ? error.message : "Failed to load discovery job",
        500,
      );
    }
  });
}
