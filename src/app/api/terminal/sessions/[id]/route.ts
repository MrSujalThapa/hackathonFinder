import { z } from "zod";
import { requireOwnerSession } from "@/app/api/discovery/_auth";
import { candidateIdSchema, fail, ok, validationError } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { withRequestLogging } from "@/server/observability/logger";
import { getTerminalSessionStore } from "@/server/terminal";

type RouteContext = { params: Promise<{ id: string }> };

const patchBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("select") }),
  z.object({ action: z.literal("touch") }),
  z.object({ action: z.literal("close") }),
  z.object({ action: z.literal("reopen") }),
  z.object({
    action: z.literal("rename"),
    title: z.string().trim().min(1).max(80),
  }),
]);

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withRequestLogging(request, "GET /api/terminal/sessions/[id]", async () => {
    const auth = await requireOwnerSession(request);
    if (auth) return auth;

    const protection = protectApiRequest(request, {
      rateLimit: { key: "terminal-session-get", limit: 60, windowMs: 60_000 },
    });
    if (protection) return protection;

    const { id } = await context.params;
    const parsedId = candidateIdSchema.safeParse(id);
    if (!parsedId.success) return validationError(parsedId.error);

    const session = await getTerminalSessionStore().getSession(parsedId.data);
    if (!session) return fail("CANDIDATE_NOT_FOUND", "Terminal session not found", 404);
    return ok({ session });
  });
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withRequestLogging(request, "PATCH /api/terminal/sessions/[id]", async () => {
    const auth = await requireOwnerSession(request);
    if (auth) return auth;

    const protection = protectApiRequest(request, {
      requireSameOrigin: true,
      maxBodyBytes: 4_000,
      rateLimit: { key: "terminal-session-patch", limit: 60, windowMs: 60_000 },
    });
    if (protection) return protection;

    const { id } = await context.params;
    const parsedId = candidateIdSchema.safeParse(id);
    if (!parsedId.success) return validationError(parsedId.error);

    const parsed = patchBodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return validationError(parsed.error);

    const store = getTerminalSessionStore();
    const session =
      parsed.data.action === "select"
        ? await store.selectSession(parsedId.data)
        : parsed.data.action === "touch"
          ? await store.touchSession(parsedId.data)
          : parsed.data.action === "close"
            ? await store.closeSession(parsedId.data)
            : parsed.data.action === "reopen"
              ? await store.reopenSession(parsedId.data)
              : await store.renameSession(parsedId.data, parsed.data.title);

    return ok({ session });
  });
}
