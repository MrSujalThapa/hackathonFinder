import { z } from "zod";
import { fail, ok, validationError } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { listApplications } from "@/server/applications/repository";
import { prepareApplication } from "@/server/applications/prepare";

const prepareSchema = z.object({ candidateId: z.string().uuid(), applicationUrl: z.string().url(), formHtml: z.string().max(1_000_000).optional() });
export async function GET() { try { return ok({ applications: await listApplications() }); } catch { return fail("INTERNAL_ERROR", "Could not load applications.", 500); } }
export async function POST(request: Request) {
  const denied = protectApiRequest(request, { requireSameOrigin: true, maxBodyBytes: 1_100_000, rateLimit: { key: "applications.prepare", limit: 15, windowMs: 60_000 } }); if (denied) return denied;
  const parsed = prepareSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return validationError(parsed.error);
  try {
    return ok(await prepareApplication(parsed.data), { status: 201 });
  } catch { return fail("INTERNAL_ERROR", "Could not prepare application.", 500); }
}
