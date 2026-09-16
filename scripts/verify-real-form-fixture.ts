import path from "node:path";
import { fillAndPreviewRealForm, submitControlledRealForm } from "@/server/applications/realForm";
import type { ApplicationDraft, ApplicationQuestion } from "@/core/applications/types";

const question = (id: string, label: string, fieldType: string, selector: string, answer: string): ApplicationQuestion => ({ id, label, fieldType, selector, answer, answerSource: "user", required: true, options: fieldType === "select" || fieldType === "radio" ? ["Yes", "No"] : [], needsUserInput: false });
const fixtureUrl = process.env.CONTROLLED_FORM_URL ?? "http://127.0.0.1:3000/fixtures/controlled-application";
const draft: ApplicationDraft = { id: "controlled-real-form", opportunityId: "controlled-opportunity", applicationUrl: fixtureUrl, status: "ready_to_submit", draftVersion: 7, approvedDraftVersion: null, approvedAt: null, currentPage: 4, totalPages: 4, checkpoint: {}, questions: [question("name", "Name", "text", "#name", "Ada Lovelace"), question("attendance", "Can you attend all days?", "radio", "input[name=\"attendance\"]", "Yes"), question("consent", "I consent to the code of conduct", "checkbox", "#consent", "Yes"), question("bio", "Short bio", "textarea", "#bio", "Student builder."), question("github", "GitHub profile", "url", "#github", "https://github.com/ada"), question("resume", "Upload your resume", "file", "#resume", path.resolve("scripts/fixtures/resume.pdf")), question("travel", "Can you arrange travel?", "select", "#travel", "Yes")] };

async function main(): Promise<void> {
  const preview = await fillAndPreviewRealForm(draft); if (!preview.reconciliation.ok) throw new Error(`Preview reconciliation failed: ${JSON.stringify(preview.reconciliation.mismatches)}`);
  const submitted = await submitControlledRealForm(draft); if (!submitted.confirmation?.includes("FIXTURE-APPLICATION")) throw new Error("Controlled fixture did not return a submission confirmation.");
  console.log(JSON.stringify({ preview: "filled_without_submit", reconciliation: "matched", submission: submitted.confirmation }));
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
