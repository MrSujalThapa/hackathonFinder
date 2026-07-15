import { fail, ok } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { withRequestLogging } from "@/server/observability/logger";
import {
  listSourceHealthSnapshots,
  readSourceSettings,
} from "@/lib/sources";

export async function GET(request: Request): Promise<Response> {
  return withRequestLogging(request, "GET /api/sources", async () => {
    const protection = protectApiRequest(request, {
      rateLimit: { key: "sources-list", limit: 60, windowMs: 60_000 },
    });
    if (protection) return protection;

    try {
      const settings = readSourceSettings();
      const sources = listSourceHealthSnapshots();
      return ok(
        {
          sources,
          enabled: settings.enabled,
          note: "Snapshots are cached; POST /api/sources/[name]/check for a live diagnostic.",
        },
        { headers: { "cache-control": "no-store" } },
      );
    } catch {
      return fail("INTERNAL_ERROR", "Failed to load source health", 500);
    }
  });
}
