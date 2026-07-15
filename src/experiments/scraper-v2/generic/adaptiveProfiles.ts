import type {
  CrawlIntent,
  CrawlIntentInput,
  CrawlPlan,
  CrawlProfile,
  DiscoveryBudget,
} from "@/experiments/scraper-v2/generic/types";

function cleanQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function addMonths(date: Date, months: number): string {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next.toISOString();
}

function inferRequestedCount(query: string): number | undefined {
  const lower = query.toLowerCase();
  const explicit = lower.match(/\b(?:top|first|find|show|roughly|about|around)?\s*(\d{1,4})\s+(?:hackathons?|events?|results?)\b/);
  if (explicit) return Number(explicit[1]);
  if (/\b500\+|hundreds?|deep\b/.test(lower)) return 500;
  if (/\bexhaustive|complete|all public\b/.test(lower)) return 1_000;
  if (/\b150|standard|normal\b/.test(lower)) return 150;
  if (/\b50|light|quick|fast|small|few\b/.test(lower)) return 50;
  return undefined;
}

function inferHorizon(input: CrawlIntentInput): Pick<CrawlIntent, "dateHorizonStart" | "dateHorizonEnd"> {
  const explicit: Pick<CrawlIntent, "dateHorizonStart" | "dateHorizonEnd"> = {};
  if (input.dateHorizonStart) explicit.dateHorizonStart = input.dateHorizonStart;
  if (input.dateHorizonEnd) explicit.dateHorizonEnd = input.dateHorizonEnd;
  if (explicit.dateHorizonStart || explicit.dateHorizonEnd) return explicit;

  const lower = input.query.toLowerCase();
  const now = new Date();
  if (/\bnext\s+2\s+weeks?|two\s+weeks?\b/.test(lower)) {
    return { dateHorizonStart: now.toISOString(), dateHorizonEnd: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString() };
  }
  if (/\bnext\s+2\s+months?|two\s+months?\b/.test(lower)) {
    return { dateHorizonStart: now.toISOString(), dateHorizonEnd: addMonths(now, 2) };
  }
  if (/\bnext\s+6\s+months?|six\s+months?|long horizon\b/.test(lower)) {
    return { dateHorizonStart: now.toISOString(), dateHorizonEnd: addMonths(now, 6) };
  }
  return {};
}

export function parseAdaptiveCrawlIntent(input: CrawlIntentInput): CrawlIntent {
  const normalizedQuery = cleanQuery(input.query);
  const targetCountHint = input.requestedCount ?? inferRequestedCount(normalizedQuery);
  const lower = normalizedQuery.toLowerCase();
  const horizon = inferHorizon(input);
  return {
    normalizedQuery,
    ...(targetCountHint !== undefined ? { targetCountHint } : {}),
    ...horizon,
    prioritizeLatency:
      input.latencyPreference === "fast" ||
      (input.latencyPreference == null && /\b(light|quick|fast|first results|low latency)\b/.test(lower)),
    prioritizeCoverage:
      input.latencyPreference === "coverage" ||
      /\b(deep|exhaustive|complete|coverage|all public|500\+|long horizon)\b/.test(lower),
  };
}

function profileForIntent(intent: CrawlIntent): CrawlProfile {
  const lower = intent.normalizedQuery.toLowerCase();
  const target = intent.targetCountHint ?? 0;
  if (/\bexhaustive|complete|all public\b/.test(lower) || target >= 900) return "exhaustive";
  if (/\bdeep|500\+|hundreds?\b/.test(lower) || target >= 500) return "deep";
  if (target >= 100 || /\bstandard|normal|150\b/.test(lower)) return "standard";
  return "light";
}

function basePlan(profile: CrawlProfile): Omit<CrawlPlan, "profile" | "dateHorizonStart" | "dateHorizonEnd" | "prioritizeLatency" | "prioritizeCoverage"> {
  switch (profile) {
    case "light":
      return {
        targetValidEvents: 50,
        maxRawRecords: 300,
        maxSources: 4,
        maxPagesPerSource: 3,
        maxRequestsPerSource: 10,
        maxBrowserActionsPerSource: 1,
        maxDetailPagesPerSource: 5,
        maxDurationMs: 45_000,
      };
    case "standard":
      return {
        targetValidEvents: 150,
        maxRawRecords: 1_200,
        maxSources: 10,
        maxPagesPerSource: 8,
        maxRequestsPerSource: 40,
        maxBrowserActionsPerSource: 2,
        maxDetailPagesPerSource: 20,
        maxDurationMs: 2 * 60_000,
      };
    case "deep":
      return {
        targetValidEvents: 500,
        maxRawRecords: 5_000,
        maxSources: 16,
        maxPagesPerSource: 30,
        maxRequestsPerSource: 120,
        maxBrowserActionsPerSource: 5,
        maxDetailPagesPerSource: 60,
        maxDurationMs: 10 * 60_000,
      };
    case "exhaustive":
      return {
        targetValidEvents: 1_000,
        maxRawRecords: 10_000,
        maxSources: 24,
        maxPagesPerSource: 80,
        maxRequestsPerSource: 240,
        maxBrowserActionsPerSource: 10,
        maxDetailPagesPerSource: 120,
        maxDurationMs: 20 * 60_000,
      };
  }
}

export function buildCrawlPlan(input: CrawlIntentInput | CrawlIntent): CrawlPlan {
  const intent = "normalizedQuery" in input ? input : parseAdaptiveCrawlIntent(input);
  const profile = profileForIntent(intent);
  const base = basePlan(profile);
  const targetValidEvents = intent.targetCountHint
    ? Math.max(profile === "light" ? 25 : 75, Math.min(intent.targetCountHint, base.targetValidEvents))
    : base.targetValidEvents;
  return {
    profile,
    ...base,
    targetValidEvents,
    ...(intent.dateHorizonStart ? { dateHorizonStart: intent.dateHorizonStart } : {}),
    ...(intent.dateHorizonEnd ? { dateHorizonEnd: intent.dateHorizonEnd } : {}),
    prioritizeLatency: intent.prioritizeLatency || profile === "light",
    prioritizeCoverage: intent.prioritizeCoverage || profile === "deep" || profile === "exhaustive",
  };
}

export function planToDiscoveryBudget(plan: CrawlPlan): DiscoveryBudget {
  return {
    profile: plan.profile === "light" ? "quick" : plan.profile,
    targetAcceptedEvents: plan.targetValidEvents,
    maxRawRecords: plan.maxRawRecords,
    maxSources: plan.maxSources,
    maxPagesPerSource: plan.maxPagesPerSource,
    maxRequestsPerSource: plan.maxRequestsPerSource,
    maxDetailPagesPerSource: plan.maxDetailPagesPerSource,
    maxDurationMs: plan.maxDurationMs,
    ...(plan.dateHorizonStart ? { dateHorizonStart: plan.dateHorizonStart } : {}),
    ...(plan.dateHorizonEnd ? { dateHorizonEnd: plan.dateHorizonEnd } : {}),
    prioritizeLatency: plan.prioritizeLatency,
    prioritizeCoverage: plan.prioritizeCoverage,
  };
}
