import { z } from "zod";
import { fail, ok, validationError } from "@/server/api/envelope";
import { syncPendingApproved } from "@/server/sheets/syncPendingApproved";

const bodySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export async function POST(request: Request): Promise<Response> {
  try {
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
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to sync approved candidates";
    return fail("INTERNAL_ERROR", message, 500);
  }
}
