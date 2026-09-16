import { z } from "zod";
import { editAnswer, pauseDraft, resumeDraft, userManageDraft } from "@/core/applications/workflow";
import { fail, ok, validationError } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { deleteApplication, getApplication, saveDraft } from "@/server/applications/repository";
import { resumeApplication } from "@/server/applications/resume";

const updateSchema = z.discriminatedUnion("action", [z.object({ action: z.literal("edit"), questionId: z.string().uuid(), answer: z.string().max(20_000) }), z.object({ action: z.literal("save") }), z.object({ action: z.literal("save_continue") }), z.object({ action: z.literal("pause") }), z.object({ action: z.literal("do_myself") }), z.object({ action: z.literal("delete") })]);
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) { const id = (await context.params).id; if (!z.string().uuid().safeParse(id).success) return fail("VALIDATION_ERROR", "Invalid application id.", 400); try { const draft = await getApplication(id); return draft ? ok({ application: draft }) : fail("CANDIDATE_NOT_FOUND", "Application not found.", 404); } catch { return fail("INTERNAL_ERROR", "Could not load application.", 500); } }
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = protectApiRequest(request, { requireSameOrigin: true, maxBodyBytes: 25_000, rateLimit: { key: "applications.update", limit: 30, windowMs: 60_000 } }); if (denied) return denied;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return validationError(parsed.error);
  const current = await getApplication((await context.params).id); if (!current) return fail("CANDIDATE_NOT_FOUND", "Application not found.", 404);
  try {
    if (parsed.data.action === "delete") { await deleteApplication(current.id); return ok({ deleted: true, message: "Draft deleted; no automation will continue." }); }
    if (parsed.data.action === "save") return ok({ application: await saveDraft(current), message: "Saved. External form inspection has not resumed." });
    if (parsed.data.action === "pause") return ok({ application: await saveDraft(pauseDraft(current)), message: "Draft paused." });
    if (parsed.data.action === "do_myself") return ok({ application: await saveDraft(userManageDraft(current)), message: "Automation stopped. This draft is now user managed." });
    if (parsed.data.action === "save_continue") { const saved = await saveDraft(resumeDraft(current)); const application = await resumeApplication(saved); const waiting = ["needs_input", "needs_file", "auth_required"].includes(application.status); return ok({ application, message: waiting ? "Saved. This draft is still waiting for the same required answers." : "Saved and continued safely. No external submission was attempted." }); }
    return ok({ application: await saveDraft(editAnswer(current, parsed.data.questionId, parsed.data.answer)) });
  } catch (error) { return fail("FORBIDDEN", error instanceof Error ? error.message : "Application transition rejected.", 409); }
}
