import { createServiceSupabaseClient } from "@/lib/supabase/createServiceClient";
import type { NotificationType } from "@/core/applications/types";

export type NotifyInput = { userId?: string; type: NotificationType; title: string; body: string; opportunityId?: string; applicationId?: string; actionUrl?: string };
export interface EmailNotifier { send(input: NotifyInput): Promise<void>; }

/** Persists the in-app inbox event first. An email adapter can be injected by deployment wiring. */
export async function notify(input: NotifyInput, email?: EmailNotifier): Promise<{ delivered: boolean; deduped: boolean }> {
  const db = createServiceSupabaseClient();
  const { error } = await db.from("notifications").insert({ user_id: input.userId ?? null, type: input.type, candidate_id: input.opportunityId ?? null, application_id: input.applicationId ?? null, title: input.title, body: input.body, action_url: input.actionUrl ?? null });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return { delivered: false, deduped: true };
    throw new Error(`Could not create notification: ${error.message}`);
  }
  if (email) await email.send(input);
  return { delivered: true, deduped: false };
}
