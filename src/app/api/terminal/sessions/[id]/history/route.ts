import { requireOwnerSession } from "@/app/api/discovery/_auth";
import { candidateIdSchema, fail, ok, validationError } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { withRequestLogging } from "@/server/observability/logger";
import { getDiscoveryJobStore } from "@/jobs/store";
import { getTerminalSessionStore } from "@/server/terminal";
import { z } from "zod";

type RouteContext = { params: Promise<{ id: string }> };

const commandBodySchema = z.object({
  command: z.string().trim().min(1).max(2_000),
});

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withRequestLogging(
    request,
    "GET /api/terminal/sessions/[id]/history",
    async () => {
      const auth = await requireOwnerSession(request);
      if (auth) return auth;

      const protection = protectApiRequest(request, {
        rateLimit: {
          key: "terminal-session-history",
          limit: 60,
          windowMs: 60_000,
        },
      });
      if (protection) return protection;

      const { id } = await context.params;
      const parsedId = candidateIdSchema.safeParse(id);
      if (!parsedId.success) return validationError(parsedId.error);

      const terminalStore = getTerminalSessionStore();
      const session = await terminalStore.getSession(parsedId.data);
      if (!session) {
        return fail("CANDIDATE_NOT_FOUND", "Terminal session not found", 404);
      }

      const jobStore = getDiscoveryJobStore();
      const commandHistory = await terminalStore.listCommandHistory(session.id, {
        limit: 50,
      });
      const jobIds = await terminalStore.listTerminalHistory(session.id, {
        limit: 10,
      });
      const jobs = (
        await Promise.all(jobIds.map((jobId) => jobStore.getJob(jobId)))
      ).filter((job) => job != null);
      const events = Object.fromEntries(
        await Promise.all(
          jobs.map(async (job) => [
            job.id,
            await jobStore.listEvents(job.id, { afterSequence: 0, limit: 200 }),
          ]),
        ),
      );

      return ok({ session, commandHistory, jobs, events });
    },
  );
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withRequestLogging(
    request,
    "POST /api/terminal/sessions/[id]/history",
    async () => {
      const auth = await requireOwnerSession(request);
      if (auth) return auth;

      const protection = protectApiRequest(request, {
        requireSameOrigin: true,
        maxBodyBytes: 4_000,
        rateLimit: {
          key: "terminal-session-command-history",
          limit: 120,
          windowMs: 60_000,
        },
      });
      if (protection) return protection;

      const { id } = await context.params;
      const parsedId = candidateIdSchema.safeParse(id);
      if (!parsedId.success) return validationError(parsedId.error);

      const parsed = commandBodySchema.safeParse(await request.json().catch(() => ({})));
      if (!parsed.success) return validationError(parsed.error);

      const entry = await getTerminalSessionStore().appendCommandHistory(
        parsedId.data,
        parsed.data.command,
      );
      return ok({ entry }, { status: 201 });
    },
  );
}
