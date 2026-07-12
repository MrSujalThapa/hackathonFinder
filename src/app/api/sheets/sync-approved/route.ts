import { z } from "zod";
import { fail, ok, validationError } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { syncPendingApproved } from "@/server/sheets/syncPendingApproved";
import { withRequestLogging } from "@/server/observability/logger";

const bodySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export async function POST(request: Request): Promise<Response> {
  return withRequestLogging(request, "POST /api/sheets/sync-approved", async () => {
  try {
    const protection = protectApiRequest(request, {
      requireSameOrigin: true,
      maxBodyBytes: 1_024,
      rateLimit: { key: "batch-sheet-sync", limit: 5, windowMs: 60_000 },
    });
    if (protection) return protection;

    let raw: unknown = {};
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      raw = await request.json().catch(() => ({}));
    }

    const parsed = bodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const summary = await syncPendingApproved({
      limit: parsed.data.limit,
      dryRun: false,
    });

    return ok(summary);
  } catch {
    return fail("INTERNAL_ERROR", "Failed to sync approved candidates", 500);
  }
  });
}
