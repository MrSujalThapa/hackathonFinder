import { fail, ok } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { withRequestLogging } from "@/server/observability/logger";
import { checkSourceHealth, isHealthableSource } from "@/lib/sources";

type RouteContext = {
  params: Promise<{ name: string }>;
};

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withRequestLogging(request, "POST /api/sources/[name]/check", async () => {
    const protection = protectApiRequest(request, {
      requireSameOrigin: true,
      maxBodyBytes: 512,
      rateLimit: { key: "sources-live-check", limit: 6, windowMs: 60_000 },
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

    try {
      const health = await checkSourceHealth(source, { live: true, persist: true });
      return ok(health, { headers: { "cache-control": "no-store" } });
    } catch {
      return fail("INTERNAL_ERROR", "Live source check failed", 500);
    }
  });
}
