import { fail, ok } from "@/server/api/envelope";
import { getOwnerDiagnostics } from "@/server/diagnostics";
import { withRequestLogging } from "@/server/observability/logger";

export async function GET(request: Request): Promise<Response> {
  return withRequestLogging(request, "GET /api/diagnostics", async () => {
  try {
    return ok(await getOwnerDiagnostics(), {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return fail("INTERNAL_ERROR", "Failed to load diagnostics", 500);
  }
  });
}
