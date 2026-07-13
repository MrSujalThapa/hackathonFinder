import { candidateIdSchema, fail, ok, validationError } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { withRequestLogging } from "@/server/observability/logger";
import { getDiscoveryJobStore } from "@/jobs/store";
import { getDiscoveryJobConcurrencyGate } from "@/discovery/concurrency";
import { requireOwnerSession } from "@/app/api/discovery/_auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withRequestLogging(
    request,
    "POST /api/discovery/jobs/[id]/cancel",
    async () => {
      const auth = await requireOwnerSession(request);
      if (auth) return auth;

      const protection = protectApiRequest(request, {
        requireSameOrigin: true,
        maxBodyBytes: 1_024,
        rateLimit: { key: "discovery-job-cancel", limit: 30, windowMs: 60_000 },
      });
      if (protection) return protection;

      const { id } = await context.params;
      const parsedId = candidateIdSchema.safeParse(id);
      if (!parsedId.success) return validationError(parsedId.error);

      try {
        const store = getDiscoveryJobStore();
        const job = await store.requestCancel(parsedId.data);
        if (!job) {
          return fail("CANDIDATE_NOT_FOUND", "Discovery job not found", 404);
        }
        // Release concurrency-gate waiters for jobs cancelled before start.
        getDiscoveryJobConcurrencyGate().cancelWaiting(job.id);
        await store.appendEvent(job.id, {
          type: "run_cancelled",
          level: "warning",
          message: "Cancel requested",
        });
        return ok({ job });
      } catch (error) {
        return fail(
          "INTERNAL_ERROR",
          error instanceof Error ? error.message : "Failed to cancel discovery job",
          500,
        );
      }
    },
  );
}
