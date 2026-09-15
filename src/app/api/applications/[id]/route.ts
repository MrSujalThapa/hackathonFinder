import { z } from "zod";
import { approveDraft, beginSubmission, editAnswer } from "@/core/applications/workflow";
import { fail, ok, validationError } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { getApplication, saveDraft } from "@/server/applications/repository";

const updateSchema = z.discriminatedUnion("action", [z.object({ action: z.literal("edit"), questionId: z.string().uuid(), answer: z.string().max(20_000) }), z.object({ action: z.literal("approve") }), z.object({ action: z.literal("submit") })]);
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) { const draft = await getApplication((await context.params).id); return draft ? ok({ application: draft }) : fail("CANDIDATE_NOT_FOUND", "Application not found.", 404); }
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = protectApiRequest(request, { requireSameOrigin: true, maxBodyBytes: 25_000, rateLimit: { key: "applications.update", limit: 30, windowMs: 60_000 } }); if (denied) return denied;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return validationError(parsed.error);
  const current = await getApplication((await context.params).id); if (!current) return fail("CANDIDATE_NOT_FOUND", "Application not found.", 404);
  try {
    if (parsed.data.action === "submit") return ok({ application: beginSubmission(current), message: "Submission is intentionally not executed by this endpoint." });
    const draft = parsed.data.action === "approve" ? approveDraft(current) : editAnswer(current, parsed.data.questionId, parsed.data.answer);
    return ok({ application: await saveDraft(draft) });
  } catch (error) { return fail("FORBIDDEN", error instanceof Error ? error.message : "Application transition rejected.", 409); }
}
