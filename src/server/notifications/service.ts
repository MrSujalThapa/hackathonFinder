import { createServiceSupabaseClient } from "@/lib/supabase/createServiceClient";
import type { NotificationType } from "@/core/applications/types";
import { getServerEnv } from "@/config/env";

export type NotifyInput = { userId?: string; type: NotificationType; title: string; body: string; priority?: 1 | 2; opportunityId?: string; applicationId?: string; actionUrl?: string; dedupeKey?: string };
export interface EmailNotifier { send(input: NotifyInput): Promise<void>; }

export type InAppNotification = { id: string; type: string; title: string; body: string; actionUrl: string | null; sentAt: string };
export type DiscordMessageResult = { id: string; actionUrl?: string; componentCount: number };

export async function listNotifications(limit = 50): Promise<InAppNotification[]> {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.from("notifications").select("id,type,title,body,action_url,sent_at").order("sent_at", { ascending: false }).limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw new Error(`Could not load notifications: ${error.message}`);
  return (data ?? []).map((row) => ({ id: row.id, type: row.type, title: row.title, body: row.body, actionUrl: row.action_url, sentAt: row.sent_at }));
}

/** Persists the in-app inbox event first. An email adapter can be injected by deployment wiring. */
export async function notify(input: NotifyInput, email?: EmailNotifier): Promise<{ delivered: boolean; deduped: boolean }> {
  const db = createServiceSupabaseClient();
  let existing = db.from("notifications").select("id").eq("type", input.type).eq("dedupe_key", input.dedupeKey ?? "legacy");
  existing = input.opportunityId ? existing.eq("candidate_id", input.opportunityId) : existing.is("candidate_id", null);
  existing = input.applicationId ? existing.eq("application_id", input.applicationId) : existing.is("application_id", null);
  const { data: prior, error: lookupError } = await existing.limit(1);
  if (lookupError) throw new Error(`Could not check notification delivery: ${lookupError.message}`);
  if (prior?.length) return { delivered: false, deduped: true };
  const { error } = await db.from("notifications").insert({ user_id: input.userId ?? null, type: input.type, candidate_id: input.opportunityId ?? null, application_id: input.applicationId ?? null, title: input.title, body: input.body, action_url: input.actionUrl ?? null, dedupe_key: input.dedupeKey ?? "legacy" });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return { delivered: false, deduped: true };
    throw new Error(`Could not create notification: ${error.message}`);
  }
  if (email) await email.send(input);
  await sendDiscord(input).catch(() => undefined);
  return { delivered: true, deduped: false };
}

function absoluteActionUrl(actionUrl?: string): string | undefined {
  if (!actionUrl) return undefined;
  if (/^https?:\/\//.test(actionUrl)) return actionUrl;
  const env = getServerEnv(); const base = env.APP_BASE_URL ?? env.NEXT_PUBLIC_APP_URL ?? env.APP_URL;
  return base ? new URL(actionUrl, base).toString() : undefined;
}

/** Outbound bot message. Incoming commands are handled separately and always owner-gated. */
export async function sendDiscord(input: NotifyInput): Promise<DiscordMessageResult | null> {
  const env = getServerEnv();
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_CHANNEL_ID) return null;
  const actionUrl = absoluteActionUrl(input.actionUrl);
  const content = `**HackFinder Agent — ${input.priority === 1 ? "ACTION REQUIRED" : "IMPORTANT"}**\n${input.title}\n${input.body}${actionUrl ? `\n${actionUrl}` : ""}`;
  const applicationId = input.applicationId;
  const components = applicationId ? [{ type: 1, components: [
    ...(actionUrl ? [{ type: 2, style: 5, label: "Answer questions", url: actionUrl }] : []),
    { type: 2, style: 2, label: "Pause", custom_id: `hf:pause:${applicationId}` },
    { type: 2, style: 2, label: "Continue", custom_id: `hf:continue:${applicationId}` },
    { type: 2, style: 4, label: "Do it myself", custom_id: `hf:do_myself:${applicationId}` },
  ] }] : [];
  const response = await fetch(`https://discord.com/api/v10/channels/${env.DISCORD_CHANNEL_ID}/messages`, { method: "POST", headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ content, components, allowed_mentions: { parse: [] } }) });
  if (!response.ok) throw new Error(`Discord delivery failed (${response.status}).`);
  const message = await response.json() as { id: string; components?: unknown[] };
  return { id: message.id, actionUrl, componentCount: message.components?.length ?? 0 };
}

export async function sendDiscordTestNotification(): Promise<DiscordMessageResult | null> {
  return sendDiscord({ type: "APPLICATION_OPEN", priority: 2, title: "Pass 1 notification test", body: "Safe test: no application action was taken.", actionUrl: "/drafts" });
}
