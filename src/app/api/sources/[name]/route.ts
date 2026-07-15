import { fail, ok } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { withRequestLogging } from "@/server/observability/logger";
import {
  isHealthableSource,
  listSourceHealthSnapshots,
} from "@/lib/sources";

type RouteContext = {
  params: Promise<{ name: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withRequestLogging(request, "GET /api/sources/[name]", async () => {
    const protection = protectApiRequest(request, {
      rateLimit: { key: "sources-one", limit: 60, windowMs: 60_000 },
    });
    if (protection) return protection;

    const { name } = await context.params;
    const source = name.trim().toLowerCase();
    if (!isHealthableSource(source)) {
      return fail(
        "VALIDATION_ERROR",
        `Unknown source. Allowed: mlh, web, hacklist, devpost, luma, hakku`,
        400,
      );
    }

    const snapshot = listSourceHealthSnapshots().find((item) => item.source === source);
    if (!snapshot) {
      return fail("INTERNAL_ERROR", "Source snapshot missing", 500);
    }

    return ok(snapshot, { headers: { "cache-control": "no-store" } });
  });
}
