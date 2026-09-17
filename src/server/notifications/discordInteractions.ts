import { createPublicKey, verify } from "node:crypto";
import { getServerEnv } from "@/config/env";
import { editAnswer, pauseDraft, resumeDraft, userManageDraft } from "@/core/applications/workflow";
import { findApplicationByOpportunityName, getApplication, listApplications, saveDraft } from "@/server/applications/repository";
import { resumeApplication } from "@/server/applications/resume";
import { submitAuthorizedDraft } from "@/server/applications/submissionService";
import { parseDiscordCommand } from "@/server/notifications/discordCommands";
import { enqueueDiscoveryJob } from "@/jobs/enqueue";
import { getDiscoveryJobStore } from "@/jobs/store";

const SPKI_ED25519_PREFIX = "302a300506032b6570032100";
export function verifyDiscordRequest(signature: string | null, timestamp: string | null, body: string, publicKey: string | undefined): boolean {
  if (!signature || !timestamp || !publicKey || !/^[0-9a-f]{64}$/i.test(publicKey) || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  try { return verify(null, Buffer.from(timestamp + body), createPublicKey({ key: Buffer.from(SPKI_ED25519_PREFIX + publicKey, "hex"), format: "der", type: "spki" }), Buffer.from(signature, "hex")); } catch { return false; }
}
let discoveredPublicKey: string | undefined;
export async function getDiscordPublicKey(): Promise<string | undefined> {
  const env = getServerEnv(); if (env.DISCORD_PUBLIC_KEY) return env.DISCORD_PUBLIC_KEY;
  if (discoveredPublicKey) return discoveredPublicKey;
  if (!env.DISCORD_BOT_TOKEN) return undefined;
  const response = await fetch("https://discord.com/api/v10/oauth2/applications/@me", { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
  if (!response.ok) return undefined;
  const application = await response.json() as { verify_key?: string };
  discoveredPublicKey = application.verify_key;
  return discoveredPublicKey;
}
export type DiscordComponentReply = { content: string; components?: unknown[] };
export type DiscordTextReply = DiscordComponentReply & { followUp?: Promise<string> };
export async function handleDiscordComponent(userId: string, customId: string): Promise<DiscordComponentReply> {
  const env = getServerEnv(); if (!env.DISCORD_USER_ID || userId !== env.DISCORD_USER_ID) return { content: "This control is only available to the configured HackFinder owner." };
  const match = /^hf:(pause|continue|do_myself|submit|submit_now|cancel):([0-9a-f-]{36})$/i.exec(customId); if (!match) return { content: "Unknown HackFinder control." };
  const draft = await getApplication(match[2]!); if (!draft) return { content: "That draft no longer exists." };
  if (match[1] === "submit") { if (draft.status !== "ready_to_submit") return { content: "This draft is not ready to submit." }; return { content: `Draft v${draft.draftVersion} is complete. No unresolved required fields.`, components: [{ type: 1, components: [{ type: 2, style: 5, label: "View real form", url: draft.applicationUrl }, { type: 2, style: 4, label: "Submit now", custom_id: `hf:submit_now:${draft.id}` }, { type: 2, style: 2, label: "Cancel", custom_id: `hf:cancel:${draft.id}` }] }] }; }
  if (match[1] === "cancel") return { content: "Submission cancelled. No action was taken." };
  if (match[1] === "submit_now") { const submitted = await submitAuthorizedDraft(draft.id); return { content: submitted.status === "submitted" ? "Fixture application submitted and snapshot saved." : "Submission blocked by final reconciliation." }; }
  if (match[1] === "pause") { await saveDraft(pauseDraft(draft)); return { content: "Draft paused." }; }
  if (match[1] === "do_myself") { await saveDraft(userManageDraft(draft)); return { content: "Automation stopped; this draft is user managed." }; }
  return { content: (await resumeApplication(await saveDraft(resumeDraft(draft)))).status === "needs_input" ? "Draft resumed and is waiting for answers." : "Draft resumed safely; final submission remains disabled." };
}
async function runDraftAction(action: "pause" | "continue" | "do_myself", draftId: string): Promise<string> { return (await handleDiscordComponent(getServerEnv().DISCORD_USER_ID ?? "", `hf:${action}:${draftId}`)).content; }
function draftLink(id?: string): string {
  const base = getServerEnv().APP_BASE_URL;
  return base ? new URL(id ? `/drafts/${id}` : "/drafts", base).toString() : "Open HackFinder locally.";
}
function renderQuestions(draft: Awaited<ReturnType<typeof findApplicationByOpportunityName>>, unansweredOnly = false): string {
  if (!draft) return "No matching application draft was found.";
  const questions = unansweredOnly ? draft.questions.filter((q) => !q.answer) : draft.questions;
  const answered = draft.questions.filter((q) => q.answer).length;
  const lines = questions.slice(0, 6).map((q, index) => `${index + 1}. ${q.label}\n${q.answer ?? "UNANSWERED"}${q.answer ? `\nSource: ${q.answerSource}` : ""}`);
  return `${draft.applicationUrl ? "Draft" : "Application"} — Draft\n${answered}/${draft.questions.length} answered\n\n${lines.join("\n\n")}\n\n${questions.length > 6 ? `Showing 6/${questions.length}. ` : ""}${draftLink(draft.id)}`;
}
async function waitForDiscovery(id: string): Promise<string> {
  const store = getDiscoveryJobStore();
  for (let attempt = 0; attempt < 180; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const job = await store.getJob(id);
    if (!job || !["completed", "failed", "cancelled"].includes(job.status)) continue;
    if (job.status !== "completed") return `Search ${job.status}: ${job.safeErrorMessage ?? "no results were saved"}.`;
    const top = Array.isArray(job.summary?.acceptedCandidates) ? job.summary.acceptedCandidates.slice(0, 3).map((candidate) => typeof candidate === "object" && candidate ? `• ${String((candidate as { name?: unknown }).name ?? "Opportunity")}` : "").filter(Boolean).join("\n") : "";
    return `Found ${job.acceptedCount} opportunities. ${Math.max(0, job.acceptedCount - job.needsReviewCount)} passed high-confidence review.${top ? `\n\nTop matches:\n${top}` : ""}\n\n${draftLink().replace(/\/drafts$/, "/queue")}`;
  }
  return "Search is still running. Open HackFinder Queue for progress.";
}
export async function handleDiscordTextCommand(userId: string, content: string): Promise<DiscordTextReply> {
  const env = getServerEnv(); const command = parseDiscordCommand(userId, content, env.DISCORD_USER_ID);
  if (!command) {
    if (!env.DISCORD_USER_ID || userId !== env.DISCORD_USER_ID) return { content: "This command is only available to the configured HackFinder owner." };
    const pendingDrafts = (await listApplications()).filter((draft) => typeof draft.checkpoint.discordPendingQuestionId === "string" && draft.questions.some((question) => question.id === draft.checkpoint.discordPendingQuestionId));
    if (pendingDrafts.length !== 1 || !content.trim()) return { content: "I only save a reply after `show question N for <draft>` establishes a pending question." };
    const draft = pendingDrafts[0]!;
    const question = draft.questions.find((item) => item.id === draft.checkpoint.discordPendingQuestionId)!;
    await saveDraft({ ...editAnswer(draft, question.id, content.trim()), checkpoint: { ...draft.checkpoint, discordPendingQuestionId: undefined } });
    return { content: `Saved to this draft: ${question.label}\n${draftLink(draft.id)}` };
  }
  if (command.action === "discover") {
    const { job } = await enqueueDiscoveryJob({ command: command.command ?? content, mode: "auto" });
    return { content: "Searching…", followUp: waitForDiscovery(job.id) };
  }
  const all = await listApplications();
  if (command.action === "status" && !command.target) return { content: `HackFinder\n\nApplications: ${all.filter((draft) => draft.status === "drafting").length} drafting, ${all.filter((draft) => ["needs_input", "needs_file"].includes(draft.status)).length} need input, ${all.filter((draft) => draft.status === "ready_to_submit").length} ready to submit.\n\n${draftLink()}` };
  if (command.action === "show_drafts") return { content: all.length ? all.slice(0, 8).map((draft) => `• ${draft.status} — ${draftLink(draft.id)}`).join("\n") : "No application drafts are tracked." };
  const draft = await findApplicationByOpportunityName(command.target ?? ""); if (!draft) return { content: "No matching application draft was found." };
  if (command.action === "status") return { content: `Draft\n${draft.status.toUpperCase()}\n${draft.questions.filter((q) => q.answer).length}/${draft.questions.length} known\n${draft.questions.filter((q) => q.required && !q.answer).length} blockers\n${draftLink(draft.id)}` };
  if (command.action === "show_qa") return { content: renderQuestions(draft) };
  if (command.action === "show_unanswered") return { content: renderQuestions(draft, true) };
  if (command.action === "show_question") {
    const question = draft.questions[(command.questionNumber ?? 0) - 1];
    if (!question) return { content: "That question number does not exist." };
    await saveDraft({ ...draft, checkpoint: { ...draft.checkpoint, discordPendingQuestionId: question.id } });
    return { content: `Question ${command.questionNumber}: ${question.label}\n${question.answer ?? "UNANSWERED"}\n\nReply with the answer to save it to this draft. ${draftLink(draft.id)}` };
  }
  if (!["pause", "continue", "do_myself"].includes(command.action)) {
    const pendingId = typeof draft.checkpoint.discordPendingQuestionId === "string" ? draft.checkpoint.discordPendingQuestionId : undefined;
    const pending = draft.questions.find((q) => q.id === pendingId);
    if (pending && content.trim()) {
      await saveDraft({ ...editAnswer(draft, pending.id, content.trim()), checkpoint: { ...draft.checkpoint, discordPendingQuestionId: undefined } });
      return { content: `Saved to this draft: ${pending.label}\n${draftLink(draft.id)}` };
    }
    return { content: "Use `show question N for <draft>` before replying with an application answer." };
  }
  return { content: await runDraftAction(command.action, draft.id) };
}
