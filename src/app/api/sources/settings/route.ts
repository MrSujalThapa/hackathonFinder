import { z } from "zod";
import { ok, validationError } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { withRequestLogging } from "@/server/observability/logger";
import {
  HEALTHABLE_SOURCES,
  readSourceSettings,
  updateSourceEnabled,
  type HealthableSourceName,
} from "@/lib/sources";

const patchSchema = z.object({
  enabled: z
    .record(z.string(), z.boolean())
    .refine(
      (value) =>
        Object.keys(value).every((key) =>
          (HEALTHABLE_SOURCES as readonly string[]).includes(key),
        ),
      { message: "Unknown source in enabled map" },
    ),
});

export async function GET(request: Request): Promise<Response> {
  return withRequestLogging(request, "GET /api/sources/settings", async () => {
    const protection = protectApiRequest(request, {
      rateLimit: { key: "sources-settings-get", limit: 60, windowMs: 60_000 },
    });
    if (protection) return protection;

    const settings = readSourceSettings();
    return ok(
      { enabled: settings.enabled },
      { headers: { "cache-control": "no-store" } },
    );
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return withRequestLogging(request, "PATCH /api/sources/settings", async () => {
    const protection = protectApiRequest(request, {
      requireSameOrigin: true,
      maxBodyBytes: 2_048,
      rateLimit: { key: "sources-settings-patch", limit: 30, windowMs: 60_000 },
    });
    if (protection) return protection;

    const body = patchSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return validationError(body.error);

    const updates: Partial<Record<HealthableSourceName, boolean>> = {};
    for (const [key, value] of Object.entries(body.data.enabled)) {
      updates[key as HealthableSourceName] = value;
    }

    const settings = updateSourceEnabled(updates);
    return ok(
      { enabled: settings.enabled },
      { headers: { "cache-control": "no-store" } },
    );
  });
}
