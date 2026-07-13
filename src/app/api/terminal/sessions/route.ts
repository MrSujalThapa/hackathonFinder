import { z } from "zod";
import { requireOwnerSession } from "@/app/api/discovery/_auth";
import { ok, validationError } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { withRequestLogging } from "@/server/observability/logger";
import { getTerminalSessionStore } from "@/server/terminal";

const createBodySchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(80).optional(),
  select: z.boolean().optional(),
});

export async function GET(request: Request): Promise<Response> {
  return withRequestLogging(request, "GET /api/terminal/sessions", async () => {
    const auth = await requireOwnerSession(request);
    if (auth) return auth;

    const protection = protectApiRequest(request, {
      rateLimit: { key: "terminal-sessions-list", limit: 60, windowMs: 60_000 },
    });
    if (protection) return protection;

    const store = getTerminalSessionStore();
    const sessions = await store.listSessions({ limit: 50 });
    return ok({
      sessions,
      selectedSession:
        sessions.find((session) => session.isSelected) ??
        (await store.restoreLatestSelectedSession()),
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  return withRequestLogging(request, "POST /api/terminal/sessions", async () => {
    const auth = await requireOwnerSession(request);
    if (auth) return auth;

    const protection = protectApiRequest(request, {
      requireSameOrigin: true,
      maxBodyBytes: 4_000,
      rateLimit: { key: "terminal-sessions-create", limit: 30, windowMs: 60_000 },
    });
    if (protection) return protection;

    const parsed = createBodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return validationError(parsed.error);

    const session = await getTerminalSessionStore().createSession(parsed.data);
    return ok({ session }, { status: 201 });
  });
}
