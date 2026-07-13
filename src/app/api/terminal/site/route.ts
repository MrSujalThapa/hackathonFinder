import { z } from "zod";
import { requireOwnerSession } from "@/app/api/discovery/_auth";
import { checkCustomSource } from "@/collectors/customSource";
import {
  createCustomSource,
  deleteCustomSource,
  getCustomSource,
  listCustomSources,
  setCustomSourceEnabled,
  updateCustomSource,
} from "@/server/customSources/repository";
import { fail, ok, validationError } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { withRequestLogging } from "@/server/observability/logger";

const bodySchema = z.object({
  action: z.enum([
    "save",
    "list",
    "status",
    "check",
    "enable",
    "disable",
    "remove_confirm",
    "configure",
  ]),
  name: z.string().trim().min(1).max(120).optional(),
  url: z.string().trim().url().optional(),
  mode: z.enum(["static", "playwright"]).optional(),
  location: z.string().trim().max(80).optional(),
  topics: z.array(z.string().trim().max(40)).max(20).optional(),
  maxItems: z.number().int().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  selectors: z
    .object({
      cardSelector: z.string().max(300).optional(),
      titleSelector: z.string().max(300).optional(),
      linkSelector: z.string().max(300).optional(),
    })
    .optional(),
});

function line(level: "info" | "success" | "warning" | "error", text: string) {
  return { level, text };
}

export async function POST(request: Request): Promise<Response> {
  return withRequestLogging(request, "POST /api/terminal/site", async () => {
    const auth = await requireOwnerSession(request);
    if (auth) return auth;

    const protection = protectApiRequest(request, {
      requireSameOrigin: true,
      maxBodyBytes: 8_192,
      rateLimit: { key: "terminal-site", limit: 30, windowMs: 60_000 },
    });
    if (protection) return protection;

    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return validationError(parsed.error);

    try {
      const input = parsed.data;
      if (input.action === "list") {
        const sites = await listCustomSources();
        return ok({
          sites,
          lines:
            sites.length === 0
              ? [line("info", "[sites] No saved custom sites.")]
              : sites.map((site) =>
                  line(
                    site.enabled ? "info" : "warning",
                    `[custom:${site.slug}] ${site.status} - ${site.listingUrl}`,
                  ),
                ),
        });
      }

      if (!input.name) {
        return fail("VALIDATION_ERROR", "Site name is required.", 400);
      }

      if (input.action === "save") {
        if (!input.url) return fail("VALIDATION_ERROR", "Site URL is required.", 400);
        const site = await createCustomSource({
          name: input.name,
          listingUrl: input.url,
          mode: input.mode ?? "static",
          locationScope: input.location ?? "global",
          topicScope: input.topics ?? [],
          maxItems: input.maxItems ?? 100,
          enabled: input.enabled ?? true,
        });
        return ok({
          site,
          lines: [
            line("success", `[site] Saved ${site.slug}`),
            line("info", `[site] URL: ${site.listingUrl}`),
            line("info", `[site] Mode: ${site.mode}`),
            line("info", `[site] Max items: ${site.maxItems}`),
            line("info", "[site] Run /site check " + site.slug),
          ],
        });
      }

      const site = await getCustomSource(input.name);
      if (!site) return fail("VALIDATION_ERROR", `Custom source not found: ${input.name}`, 404);

      if (input.action === "status") {
        return ok({
          site,
          lines: [
            line(
              site.enabled ? "info" : "warning",
              `[custom:${site.slug}] ${site.status} - ${site.listingUrl}`,
            ),
          ],
        });
      }

      if (input.action === "check") {
        const result = await checkCustomSource(site);
        const checked = await getCustomSource(site.slug);
        const healthy = result.status === "completed";
        return ok({
          site: checked ?? site,
          lines: [
            line(
              healthy ? "success" : "warning",
              healthy
                ? `[custom:${site.slug}] healthy - ${result.leads.length} event-like cards detected`
                : `[custom:${site.slug}] degraded - ${
                    result.errors[0] ?? result.warnings[0] ?? "No event cards detected"
                  }`,
            ),
          ],
        });
      }

      if (input.action === "enable" || input.action === "disable") {
        const updated = await setCustomSourceEnabled(site.slug, input.action === "enable");
        return ok({
          site: updated,
          lines: [
            line(
              "success",
              `[custom:${updated.slug}] ${updated.enabled ? "enabled" : "disabled"}`,
            ),
          ],
        });
      }

      if (input.action === "configure") {
        const updated = await updateCustomSource(site.slug, {
          selectors: input.selectors,
          mode: input.mode,
          maxItems: input.maxItems,
          locationScope: input.location,
          topicScope: input.topics,
        });
        return ok({
          site: updated,
          lines: [line("success", `[custom:${updated.slug}] configuration updated`)],
        });
      }

      await deleteCustomSource(site.slug);
      return ok({
        site,
        lines: [line("success", `[custom:${site.slug}] removed`)],
      });
    } catch (error) {
      return fail(
        "INTERNAL_ERROR",
        error instanceof Error ? error.message : "Site command failed.",
        500,
      );
    }
  });
}
