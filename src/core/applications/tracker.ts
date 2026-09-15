import type { ApplicationDraft, NotificationType } from "@/core/applications/types";
export type TrackerOpportunity = { id: string; title: string; applicationOpensAt?: string | null; applicationDeadline?: string | null; application?: ApplicationDraft | null };
export type TrackerEvent = { type: NotificationType; opportunityId: string };
export function trackOpportunities(opportunities: TrackerOpportunity[], now: Date, alreadySent = new Set<string>()): TrackerEvent[] {
  return opportunities.flatMap((opportunity) => {
    const events: TrackerEvent[] = []; const open = opportunity.applicationOpensAt && new Date(opportunity.applicationOpensAt); const deadline = opportunity.applicationDeadline && new Date(opportunity.applicationDeadline);
    if (open && open <= now && !opportunity.application && !alreadySent.has(`${opportunity.id}:APPLICATION_OPEN`)) events.push({ type: "APPLICATION_OPEN", opportunityId: opportunity.id });
    if (deadline && deadline > now && deadline.getTime() - now.getTime() <= 86400000 && !alreadySent.has(`${opportunity.id}:DEADLINE_SOON`)) events.push({ type: "DEADLINE_SOON", opportunityId: opportunity.id });
    return events;
  });
}
