import { generateJson } from "@/lib/llm/structured";
import type { LlmProvider } from "@/lib/llm/types";
import { matchQuestionBank } from "@/core/applications/questionBank";
import type { ApplicationDraft, ApplicationQuestion, AssetBankEntry, Profile, QuestionBankEntry } from "@/core/applications/types";

export type DraftMetrics = { modelCalls: number; inputTokens: number; outputTokens: number; profile: number; questionBank: number; assetBank: number; ai: number; user: number };
const profileKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]/g, "");
const isUserOnly = (label: string) => /attend|consent|agree|confirm|legal|payment|captcha|availability/i.test(label);
const isText = (q: ApplicationQuestion) => q.fieldType === "textarea" || q.fieldType === "text";
const wantsAsset = (q: ApplicationQuestion) => /resume|cv|transcript|headshot|deck|portfolio|linkedin|github|website|video|devpost|document|upload/i.test(q.label);
const assetMatches = (q: ApplicationQuestion, asset: AssetBankEntry) => {
  const haystack = `${asset.label} ${asset.assetType}`.toLowerCase();
  const label = q.label.toLowerCase();
  return (/(upload|file|resume|cv|transcript|headshot|deck|document)/.test(label) ? asset.kind === "file" : asset.kind === "link") &&
    [...label.matchAll(/[a-z]{4,}/g)].some(([term]) => haystack.includes(term));
};

export async function draftApplication(draft: ApplicationDraft, profile: Profile, bank: QuestionBankEntry[], llm: LlmProvider, assets: AssetBankEntry[] = []): Promise<{ draft: ApplicationDraft; metrics: DraftMetrics }> {
  const metrics: DraftMetrics = { modelCalls: 0, inputTokens: 0, outputTokens: 0, profile: 0, questionBank: 0, assetBank: 0, ai: 0, user: 0 };
  const questions = draft.questions.map((question) => {
    if (question.answer) return question;
    const value = profile[profileKey(question.label)] ?? profile[question.label.toLowerCase()];
    if (value) { metrics.profile++; return { ...question, answer: value, answerSource: "profile" as const }; }
    const entry = matchQuestionBank(question.label, bank);
    if (entry) { metrics.questionBank++; return { ...question, answer: entry.answer, answerSource: "question_bank" as const }; }
    const asset = assets.find((candidate) => assetMatches(question, candidate));
    if (asset) { metrics.assetBank++; return { ...question, answer: asset.value, answerSource: "asset_bank" as const }; }
    if (wantsAsset(question)) { metrics.user++; return { ...question, needsUserInput: question.required, answerSource: "unresolved" as const }; }
    if (isUserOnly(question.label) || !isText(question)) { metrics.user++; return { ...question, needsUserInput: question.required, answerSource: "unresolved" as const }; }
    return question;
  });
  const aiQuestions = questions.filter((question) => !question.answer && isText(question) && !question.needsUserInput);
  if (aiQuestions.length) {
    const response = await generateJson<{ answers: Array<{ id: string; answer: string }> }>(llm, { messages: [{ role: "system", content: "Draft concise application answers. Return JSON only." }, { role: "user", content: JSON.stringify({ questions: aiQuestions.map(({ id, label, maxLength }) => ({ id, question: label, maxLength })) }) }], maxOutputTokens: 1200 });
    metrics.modelCalls = 1; metrics.inputTokens = response.response.usage?.inputTokens ?? 0; metrics.outputTokens = response.response.usage?.outputTokens ?? 0;
    const answers = new Map(response.value.answers.map((answer) => [answer.id, answer.answer]));
    for (const question of questions) if (answers.has(question.id)) { question.answer = answers.get(question.id) ?? null; question.answerSource = "ai"; metrics.ai++; }
  }
  const needsInput = questions.some((question) => question.required && !question.answer);
  const needsFile = questions.some((question) => question.required && !question.answer && wantsAsset(question));
  return { draft: { ...draft, questions, draftVersion: draft.draftVersion + 1, status: needsFile ? "needs_file" : needsInput ? "needs_input" : "ready_to_submit" }, metrics };
}

export function editAnswer(draft: ApplicationDraft, questionId: string, answer: string): ApplicationDraft {
  const questions = draft.questions.map((question) => question.id === questionId ? { ...question, answer, answerSource: "user" as const, needsUserInput: false } : question);
  const complete = !questions.some((question) => question.required && !question.answer);
  return { ...draft, status: draft.status === "approved" || ((draft.status === "needs_input" || draft.status === "needs_file") && complete) ? "drafting" : draft.status, approvedAt: null, approvedDraftVersion: null, draftVersion: draft.draftVersion + 1, questions };
}

export function pauseDraft(draft: ApplicationDraft): ApplicationDraft { return { ...draft, status: "paused", draftVersion: draft.draftVersion + 1 }; }
export function userManageDraft(draft: ApplicationDraft): ApplicationDraft { return { ...draft, status: "user_managed", draftVersion: draft.draftVersion + 1 }; }
export function resumeDraft(draft: ApplicationDraft): ApplicationDraft {
  if (["user_managed", "submitted", "failed"].includes(draft.status)) throw new Error("This draft cannot be resumed by automation.");
  return { ...draft, status: "drafting", draftVersion: draft.draftVersion + 1 };
}

export function approveDraft(draft: ApplicationDraft, approvedAt = new Date().toISOString()): ApplicationDraft {
  if (draft.status !== "ready_for_review" || draft.questions.some((q) => q.required && !q.answer)) throw new Error("Only a complete draft ready for review can be approved.");
  return { ...draft, status: "approved", approvedAt, approvedDraftVersion: draft.draftVersion };
}

export function beginSubmission(draft: ApplicationDraft): ApplicationDraft {
  if (draft.status !== "approved" || draft.approvedDraftVersion !== draft.draftVersion) throw new Error("Submission requires explicit approval of the current draft.");
  return { ...draft, status: "submitting" };
}
