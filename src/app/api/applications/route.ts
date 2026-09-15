import { z } from "zod";
import { inspectApplicationForm } from "@/core/applications/formInspection";
import { draftApplication } from "@/core/applications/workflow";
import { createLlmProviderOptional } from "@/lib/llm/createProvider";
import { fail, ok, validationError } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { createApplication, getProfile, listApplications, listQuestionBank, saveDraft } from "@/server/applications/repository";
import { notify } from "@/server/notifications/service";
import { inspectApplicationUrl } from "@/server/applications/inspectForm";

const prepareSchema = z.object({ candidateId: z.string().uuid(), applicationUrl: z.string().url(), formHtml: z.string().max(1_000_000).optional() });
export async function GET() { try { return ok({ applications: await listApplications() }); } catch { return fail("INTERNAL_ERROR", "Could not load applications.", 500); } }
export async function POST(request: Request) {
  const denied = protectApiRequest(request, { requireSameOrigin: true, maxBodyBytes: 1_100_000, rateLimit: { key: "applications.prepare", limit: 15, windowMs: 60_000 } }); if (denied) return denied;
  const parsed = prepareSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return validationError(parsed.error);
  try {
    const inspected = parsed.data.formHtml ? { questions: inspectApplicationForm(parsed.data.formHtml), blocker: null } : await inspectApplicationUrl(parsed.data.applicationUrl);
    const extracted = inspected.questions;
    let draft = await createApplication(parsed.data.candidateId, parsed.data.applicationUrl, extracted);
    const llm = createLlmProviderOptional();
    if (inspected.blocker) { draft = await saveDraft({ ...draft, status: "needs_input" }); await notify({ type: "APPLICATION_NEEDS_INPUT", opportunityId: draft.opportunityId, applicationId: draft.id, title: "Application needs your attention", body: `Inspection paused because ${inspected.blocker} requires your interaction.`, actionUrl: `/applications/${draft.id}` }); return ok({ application: draft, metrics: null, blocker: inspected.blocker }, { status: 201 }); }
    if (llm) { const result = await draftApplication(draft, await getProfile(), await listQuestionBank(), llm); draft = await saveDraft(result.draft); if (draft.status === "needs_input" || draft.status === "ready_for_review") await notify({ type: draft.status === "needs_input" ? "APPLICATION_NEEDS_INPUT" : "APPLICATION_READY_FOR_REVIEW", opportunityId: draft.opportunityId, applicationId: draft.id, title: draft.status === "needs_input" ? "Application needs your input" : "Application ready for review", body: draft.status === "needs_input" ? "Everything resolvable has been drafted; complete the remaining required fields." : "Your application draft is ready for review.", actionUrl: `/applications/${draft.id}` }); return ok({ application: draft, metrics: result.metrics }, { status: 201 }); }
    return ok({ application: draft, metrics: null }, { status: 201 });
  } catch { return fail("INTERNAL_ERROR", "Could not prepare application.", 500); }
}
