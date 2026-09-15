import { createServiceSupabaseClient } from "@/lib/supabase/createServiceClient";
import type { NotificationType } from "@/core/applications/types";

export type NotifyInput = { userId?: string; type: NotificationType; title: string; body: string; opportunityId?: string; applicationId?: string; actionUrl?: string };
export interface EmailNotifier { send(input: NotifyInput): Promise<void>; }

export type InAppNotification = { id: string; type: string; title: string; body: string; actionUrl: string | null; sentAt: string };

export async function listNotifications(limit = 50): Promise<InAppNotification[]> {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.from("notifications").select("id,type,title,body,action_url,sent_at").order("sent_at", { ascending: false }).limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw new Error(`Could not load notifications: ${error.message}`);
  return (data ?? []).map((row) => ({ id: row.id, type: row.type, title: row.title, body: row.body, actionUrl: row.action_url, sentAt: row.sent_at }));
}

/** Persists the in-app inbox event first. An email adapter can be injected by deployment wiring. */
export async function notify(input: NotifyInput, email?: EmailNotifier): Promise<{ delivered: boolean; deduped: boolean }> {
  const db = createServiceSupabaseClient();
  let existing = db.from("notifications").select("id").eq("type", input.type);
  existing = input.opportunityId ? existing.eq("candidate_id", input.opportunityId) : existing.is("candidate_id", null);
  existing = input.applicationId ? existing.eq("application_id", input.applicationId) : existing.is("application_id", null);
  const { data: prior, error: lookupError } = await existing.limit(1);
  if (lookupError) throw new Error(`Could not check notification delivery: ${lookupError.message}`);
  if (prior?.length) return { delivered: false, deduped: true };
  const { error } = await db.from("notifications").insert({ user_id: input.userId ?? null, type: input.type, candidate_id: input.opportunityId ?? null, application_id: input.applicationId ?? null, title: input.title, body: input.body, action_url: input.actionUrl ?? null });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return { delivered: false, deduped: true };
    throw new Error(`Could not create notification: ${error.message}`);
  }
  if (email) await email.send(input);
  return { delivered: true, deduped: false };
}
