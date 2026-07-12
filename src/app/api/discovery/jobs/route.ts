import { z } from "zod";
import {
  createJobBodySchema,
  readDiscoveryRuntimeConfig,
} from "@/discovery/config";
import { sourceNameSchema } from "@/core/discovery/schemas";
import { enqueueDiscoveryJob } from "@/jobs/enqueue";
import { getDiscoveryJobStore } from "@/jobs/store";
import { fail, ok, validationError } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { withRequestLogging } from "@/server/observability/logger";
import { requireOwnerSession } from "@/app/api/discovery/_auth";

export async function GET(request: Request): Promise<Response> {
  return withRequestLogging(request, "GET /api/discovery/jobs", async () => {
    const auth = await requireOwnerSession(request);
    if (auth) return auth;

    const protection = protectApiRequest(request, {
      rateLimit: { key: "discovery-jobs-list", limit: 60, windowMs: 60_000 },
    });
    if (protection) return protection;

    try {
      const url = new URL(request.url);
      const limit = z.coerce
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .default(20)
        .parse(url.searchParams.get("limit") ?? undefined);

      const store = getDiscoveryJobStore();
      const jobs = await store.listJobs({ limit });
      return ok({ jobs, executionMode: readDiscoveryRuntimeConfig().executionMode });
    } catch (error) {
      return fail(
        "INTERNAL_ERROR",
        error instanceof Error ? error.message : "Failed to list discovery jobs",
        500,
      );
    }
  });
}

export async function POST(request: Request): Promise<Response> {
  return withRequestLogging(request, "POST /api/discovery/jobs", async () => {
    const auth = await requireOwnerSession(request);
    if (auth) return auth;

    const protection = protectApiRequest(request, {
      requireSameOrigin: true,
      maxBodyBytes: 8_192,
      rateLimit: { key: "discovery-jobs-create", limit: 10, windowMs: 60_000 },
    });
    if (protection) return protection;

    try {
      const raw = await request.json().catch(() => null);
      const parsed = createJobBodySchema.safeParse(raw);
      if (!parsed.success) return validationError(parsed.error);

      // Reject shell-like / arbitrary OS commands — discovery commands only.
      const command = parsed.data.command.trim();
      if (/^[\$>]|^\s*(rm|sudo|curl|wget|bash|sh|powershell|cmd)\b/i.test(command)) {
        return fail(
          "VALIDATION_ERROR",
          "Shell commands are not allowed. Use a discovery request such as “find upcoming AI hackathons”.",
          400,
        );
      }

      let requestedSources = parsed.data.sources;
      if (requestedSources) {
        const checked = z.array(sourceNameSchema).safeParse(requestedSources);
        if (!checked.success) return validationError(checked.error);
        requestedSources = checked.data;
      }

      const { job, execution } = await enqueueDiscoveryJob({
        command,
        requestedSources: requestedSources as
          | import("@/core/discovery/types").SourceName[]
          | undefined,
        mode: parsed.data.mode,
        dryRun: parsed.data.dryRun === true,
        maxAgentCalls: parsed.data.maxAgentCalls,
        allSources: parsed.data.allSources === true,
      });

      return ok({ job, execution }, { status: 201 });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create discovery job";
      if (/too many active/i.test(message) || /allowlisted/i.test(message)) {
        return fail("VALIDATION_ERROR", message, 400);
      }
      return fail("INTERNAL_ERROR", message, 500);
    }
  });
}
