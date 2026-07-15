import { requireOwnerSession } from "@/app/api/discovery/_auth";
import { getTerminalStorageCapability } from "@/server/terminal";
import { ok } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { withRequestLogging } from "@/server/observability/logger";

export async function GET(request: Request): Promise<Response> {
  return withRequestLogging(request, "GET /api/terminal/storage", async () => {
    const auth = await requireOwnerSession(request);
    if (auth) return auth;

    const protection = protectApiRequest(request, {
      rateLimit: { key: "terminal-storage", limit: 30, windowMs: 60_000 },
    });
    if (protection) return protection;

    return ok(getTerminalStorageCapability(), {
      headers: { "cache-control": "no-store" },
    });
  });
}
