import { z } from "zod";
import { requireOwnerSession } from "@/app/api/discovery/_auth";
import {
  assertHealthableSource,
  type HealthableSourceName,
} from "@/lib/sources";
import {
  checkTerminalSource,
  confirmTerminalSourceDisconnect,
  connectTerminalSource,
  getTerminalSourceStatus,
  requestTerminalSourceDisconnect,
} from "@/server/sources/terminalConnection";
import { fail, ok, validationError } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { withRequestLogging } from "@/server/observability/logger";

const terminalSourceBodySchema = z.object({
  action: z.enum(["status", "check", "connect", "disconnect", "confirm_disconnect"]),
  source: z.string().trim().min(1),
  sessionId: z.string().trim().min(1).max(200),
});

async function runAction(
  action: z.infer<typeof terminalSourceBodySchema>["action"],
  source: HealthableSourceName,
  sessionId: string,
) {
  const context = { sessionId };
  if (action === "status") return getTerminalSourceStatus(source, context);
  if (action === "check") return checkTerminalSource(source, context);
  if (action === "connect") return connectTerminalSource(source, context);
  if (action === "disconnect") {
    return requestTerminalSourceDisconnect(source, context);
  }
  return confirmTerminalSourceDisconnect(source, context);
}

export async function POST(request: Request): Promise<Response> {
  return withRequestLogging(request, "POST /api/terminal/source", async () => {
    const auth = await requireOwnerSession(request);
    if (auth) return auth;

    const protection = protectApiRequest(request, {
      requireSameOrigin: true,
      maxBodyBytes: 1_024,
      rateLimit: { key: "terminal-source", limit: 20, windowMs: 60_000 },
    });
    if (protection) return protection;

    const raw = await request.json().catch(() => null);
    const parsed = terminalSourceBodySchema.safeParse(raw);
    if (!parsed.success) return validationError(parsed.error);

    let source: HealthableSourceName;
    try {
      source = assertHealthableSource(parsed.data.source);
    } catch (error) {
      return fail(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Unknown source.",
        400,
      );
    }

    try {
      const result = await runAction(
        parsed.data.action,
        source,
        parsed.data.sessionId,
      );
      return ok(result, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return fail(
        "INTERNAL_ERROR",
        error instanceof Error ? error.message : "Terminal source command failed.",
        500,
      );
    }
  });
}
