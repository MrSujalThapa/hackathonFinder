import { listApplications } from "@/server/applications/repository";
import { notify } from "@/server/notifications/service";
import { trackOpportunities } from "@/core/applications/tracker";
import { createServiceSupabaseClient } from "@/lib/supabase/createServiceClient";

/** Intended for a cron/worker invocation; it never keeps a process sleeping. */
export async function runApplicationTracker(now = new Date()): Promise<{ notifications: number }> {
  const db = createServiceSupabaseClient();
  const [{ data: candidates, error }, applications] = await Promise.all([
    db.from("candidates").select("id,name,application_opens_at,deadline"),
    listApplications(),
  ]);
  if (error) throw new Error(`Could not load application schedules: ${error.message}`);
  const appByCandidate = new Map(applications.map((application) => [application.opportunityId, application]));
  const events = trackOpportunities((candidates ?? []).map((candidate) => ({ id: candidate.id, title: candidate.name, applicationOpensAt: candidate.application_opens_at, applicationDeadline: candidate.deadline, application: appByCandidate.get(candidate.id) ?? null })), now);
  for (const event of events) {
    const candidate = (candidates ?? []).find((item) => item.id === event.opportunityId);
    const application = appByCandidate.get(event.opportunityId);
    await notify({ type: event.type, opportunityId: event.opportunityId, applicationId: application?.id, title: event.type === "APPLICATION_OPEN" ? `${candidate?.name ?? "Opportunity"} applications are open` : `${candidate?.name ?? "Opportunity"} deadline is approaching`, body: event.type === "APPLICATION_OPEN" ? "Prepare a draft application when you are ready." : application?.status === "ready_for_review" ? "Your draft is ready for review." : "Prepare an application before the deadline.", actionUrl: application ? `/applications/${application.id}` : "/applications" });
  }
  return { notifications: events.length };
}
