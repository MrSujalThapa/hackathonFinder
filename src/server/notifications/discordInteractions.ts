import { createPublicKey, verify } from "node:crypto";
import { getServerEnv } from "@/config/env";
import { pauseDraft, resumeDraft, userManageDraft } from "@/core/applications/workflow";
import { findApplicationByOpportunityName, getApplication, listApplications, saveDraft } from "@/server/applications/repository";
import { resumeApplication } from "@/server/applications/resume";
import { submitAuthorizedDraft } from "@/server/applications/submissionService";
import { parseDiscordCommand } from "@/server/notifications/discordCommands";

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
export async function handleDiscordTextCommand(userId: string, content: string): Promise<string> {
  const env = getServerEnv(); const command = parseDiscordCommand(userId, content, env.DISCORD_USER_ID); if (!command) return "This command is only available to the configured HackFinder owner.";
  if (command.action === "status") return `${(await listApplications()).length} application draft(s) tracked.`;
  if (command.action === "show_drafts") return "Open the Drafts page in HackFinder.";
  const draft = await findApplicationByOpportunityName(command.target ?? ""); if (!draft) return "No matching application draft was found.";
  return runDraftAction(command.action, draft.id);
}
