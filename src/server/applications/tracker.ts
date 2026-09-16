import { listApplications } from "@/server/applications/repository";
import { notify } from "@/server/notifications/service";
import { trackOpportunities } from "@/core/applications/tracker";
import { createServiceSupabaseClient } from "@/lib/supabase/createServiceClient";
import { prepareApplication } from "@/server/applications/prepare";

/** Intended for a cron/worker invocation; it never keeps a process sleeping. */
export async function runApplicationTracker(now = new Date()): Promise<{ notifications: number }> {
  const db = createServiceSupabaseClient();
  const [{ data: candidates, error }, applications] = await Promise.all([
    db.from("candidates").select("id,name,apply_url,application_opens_at,deadline,status").eq("status", "APPROVED"),
    listApplications(),
  ]);
  if (error) throw new Error(`Could not load application schedules: ${error.message}`);
  const appByCandidate = new Map(applications.map((application) => [application.opportunityId, application]));
  const events = trackOpportunities((candidates ?? []).map((candidate) => ({ id: candidate.id, title: candidate.name, applicationOpensAt: candidate.application_opens_at, applicationDeadline: candidate.deadline, application: appByCandidate.get(candidate.id) ?? null })), now);
  for (const event of events) {
    const candidate = (candidates ?? []).find((item) => item.id === event.opportunityId);
    let application = appByCandidate.get(event.opportunityId);
    if (event.type === "APPLICATION_OPEN" && !application && candidate?.apply_url) {
      const prepared = await prepareApplication({ candidateId: candidate.id, applicationUrl: candidate.apply_url });
      application = prepared.application;
    }
    const title = event.type === "APPLICATION_OPEN" ? `${candidate?.name ?? "Opportunity"} applications are open` : event.type === "APPLICATION_NEEDS_INPUT" ? "Application needs your input" : `${candidate?.name ?? "Opportunity"} deadline is approaching`;
    const body = event.type === "APPLICATION_OPEN" ? "Prepare a draft application when you are ready." : event.type === "APPLICATION_NEEDS_INPUT" ? "Everything resolvable is drafted; complete the remaining required fields." : application?.status === "ready_for_review" ? "Your draft is ready for review." : "Prepare an application before the deadline.";
    await notify({ type: event.type, opportunityId: event.opportunityId, applicationId: application?.id, title, body, actionUrl: application ? `/applications/${application.id}` : `/candidate/${event.opportunityId}` });
  }
  return { notifications: events.length };
}
