import type {
  DateCoverageSummary,
  DiscoveryBudget,
  GenericShadowLead,
} from "@/experiments/scraper-v2/generic/types";
import { normalizeRatio } from "@/experiments/scraper-v2/generic/valueUtils";

type StopInput = {
  budget: DiscoveryBudget;
  coverage: DateCoverageSummary;
  acceptedEvents: number;
  pagesCompleted: number;
  stableIdentityGrowth: number;
  repeatedFingerprint: boolean;
  expiredOrIrrelevantStreak: number;
  sourceHasMorePages: boolean;
  elapsedMs: number;
};

function toTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : time;
}

function minIso(values: string[]): string | undefined {
  return values.sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0];
}

function maxIso(values: string[]): string | undefined {
  return values.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
}

function isOpenRegistration(lead: GenericShadowLead): boolean {
  return lead.normalizedStatus === "open" || lead.normalizedStatus === "upcoming" || lead.normalizedStatus === "ongoing";
}

function isExpiredOrClosed(lead: GenericShadowLead): boolean {
  return lead.normalizedStatus === "past" || lead.normalizedStatus === "closed";
}

export function summarizeDateCoverage(input: {
  leads: GenericShadowLead[];
  rawRecords: number;
  dateHorizonStart?: string;
  dateHorizonEnd?: string;
  previous?: DateCoverageSummary;
}): DateCoverageSummary {
  const eventDates = input.leads.flatMap((lead) => [lead.startDate, lead.endDate].filter((value): value is string => Boolean(value)));
  const deadlines = input.leads.map((lead) => lead.deadline).filter((value): value is string => Boolean(value));
  const start = toTime(input.dateHorizonStart);
  const end = toTime(input.dateHorizonEnd);
  const inHorizonEvents = input.leads.filter((lead) => {
    const candidates = [toTime(lead.startDate), toTime(lead.endDate), toTime(lead.deadline)].filter(
      (value): value is number => value !== undefined,
    );
    if (candidates.length === 0) return false;
    return candidates.some((time) => (start === undefined || time >= start) && (end === undefined || time <= end));
  }).length;
  const earliestEventDate = minIso(eventDates);
  const latestEventDate = maxIso(eventDates);
  const previousLatest = toTime(input.previous?.latestEventDate);
  const currentLatest = toTime(latestEventDate);
  let dateProgression: DateCoverageSummary["dateProgression"] = "unknown";
  if (previousLatest !== undefined && currentLatest !== undefined) {
    if (currentLatest > previousLatest) dateProgression = "forward";
    else if (currentLatest < previousLatest) dateProgression = "backward";
    else dateProgression = "flat";
  }
  const horizonCovered =
    start === undefined && end === undefined
      ? input.leads.length > 0
      : (start === undefined || (toTime(earliestEventDate) ?? Number.POSITIVE_INFINITY) <= start) &&
        (end === undefined || (toTime(latestEventDate) ?? 0) >= end);

  return {
    ...(earliestEventDate ? { earliestEventDate } : {}),
    ...(latestEventDate ? { latestEventDate } : {}),
    ...(minIso(deadlines) ? { earliestDeadline: minIso(deadlines) } : {}),
    ...(maxIso(deadlines) ? { latestDeadline: maxIso(deadlines) } : {}),
    openRegistrationRate: normalizeRatio(input.leads.filter(isOpenRegistration).length / Math.max(1, input.leads.length)),
    expiredOrClosedRate: normalizeRatio(input.leads.filter(isExpiredOrClosed).length / Math.max(1, input.leads.length)),
    inHorizonEvents,
    validEvents: input.leads.length,
    rawRecords: input.rawRecords,
    dateProgression,
    horizonCovered,
  };
}

export function decideCrawlContinuation(input: StopInput): {
  continue: boolean;
  stopReason:
    | "target_and_horizon_satisfied"
    | "source_exhausted"
    | "no_stable_identity_growth"
    | "repeated_fingerprint"
    | "expired_or_irrelevant_streak"
    | "timeout"
    | "page_cap"
    | "continue";
} {
  if (input.elapsedMs >= input.budget.maxDurationMs) return { continue: false, stopReason: "timeout" };
  if (input.pagesCompleted >= input.budget.maxPagesPerSource) return { continue: false, stopReason: "page_cap" };
  if (input.repeatedFingerprint) return { continue: false, stopReason: "repeated_fingerprint" };
  if (input.expiredOrIrrelevantStreak >= 3) return { continue: false, stopReason: "expired_or_irrelevant_streak" };
  if (!input.sourceHasMorePages) return { continue: false, stopReason: "source_exhausted" };
  if (input.acceptedEvents >= input.budget.targetAcceptedEvents && input.coverage.horizonCovered) {
    return { continue: false, stopReason: "target_and_horizon_satisfied" };
  }
  if (input.stableIdentityGrowth <= 0 && input.pagesCompleted > 0) {
    return { continue: false, stopReason: "no_stable_identity_growth" };
  }
  return { continue: true, stopReason: "continue" };
}
