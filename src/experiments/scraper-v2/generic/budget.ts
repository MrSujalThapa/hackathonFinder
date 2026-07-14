import type {
  CrawlIntent,
  CrawlIntentInput,
  DiscoveryBudget,
} from "@/experiments/scraper-v2/generic/types";

function cleanQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function inferCountFromText(query: string): number | undefined {
  const lower = query.toLowerCase();
  const explicit = lower.match(/\b(?:top|first|find|show|roughly|about|around)?\s*(\d{1,4})\s+(?:hackathons?|events?|results?)\b/);
  if (explicit) return Number(explicit[1]);
  if (/\b500\+|hundreds?|deep\b/.test(lower)) return 500;
  if (/\bquick|fast|small|few|25|50\b/.test(lower)) return 50;
  if (/\bstandard|normal|100|150|200\b/.test(lower)) return 150;
  return undefined;
}

function addMonths(date: Date, months: number): string {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next.toISOString();
}

function inferHorizon(input: CrawlIntentInput): Pick<CrawlIntent, "dateHorizonStart" | "dateHorizonEnd"> {
  const explicit: Pick<CrawlIntent, "dateHorizonStart" | "dateHorizonEnd"> = {};
  if (input.dateHorizonStart) explicit.dateHorizonStart = input.dateHorizonStart;
  if (input.dateHorizonEnd) explicit.dateHorizonEnd = input.dateHorizonEnd;
  if (explicit.dateHorizonStart || explicit.dateHorizonEnd) return explicit;

  const lower = input.query.toLowerCase();
  const now = new Date();
  if (/\bnext\s+6\s+months?|six\s+months?|long horizon\b/.test(lower)) {
    return { dateHorizonStart: now.toISOString(), dateHorizonEnd: addMonths(now, 6) };
  }
  if (/\bnext\s+year|12\s+months?\b/.test(lower)) {
    return { dateHorizonStart: now.toISOString(), dateHorizonEnd: addMonths(now, 12) };
  }
  return {};
}

export function parseCrawlIntent(input: CrawlIntentInput): CrawlIntent {
  const normalizedQuery = cleanQuery(input.query);
  const targetCountHint = input.requestedCount ?? inferCountFromText(normalizedQuery);
  const horizon = inferHorizon(input);
  const lower = normalizedQuery.toLowerCase();
  const prioritizeLatency =
    input.latencyPreference === "fast" ||
    (input.latencyPreference == null && /\bquick|fast|low latency|first results\b/.test(lower));
  const prioritizeCoverage =
    input.latencyPreference === "coverage" ||
    /\bdeep|exhaustive|complete|coverage|all public|500\+|long horizon\b/.test(lower);

  return {
    normalizedQuery,
    ...(targetCountHint !== undefined ? { targetCountHint } : {}),
    ...horizon,
    prioritizeLatency,
    prioritizeCoverage,
  };
}

function budgetForProfile(
  profile: DiscoveryBudget["profile"],
): Omit<DiscoveryBudget, "profile" | "dateHorizonStart" | "dateHorizonEnd" | "prioritizeLatency" | "prioritizeCoverage"> {
  switch (profile) {
    case "quick":
      return {
        targetAcceptedEvents: 50,
        maxRawRecords: 250,
        maxSources: 4,
        maxPagesPerSource: 3,
        maxRequestsPerSource: 8,
        maxDetailPagesPerSource: 6,
        maxDurationMs: 30_000,
      };
    case "deep":
      return {
        targetAcceptedEvents: 500,
        maxRawRecords: 3_000,
        maxSources: 16,
        maxPagesPerSource: 40,
        maxRequestsPerSource: 120,
        maxDetailPagesPerSource: 60,
        maxDurationMs: 10 * 60_000,
      };
    case "exhaustive":
      return {
        targetAcceptedEvents: 1_000,
        maxRawRecords: 8_000,
        maxSources: 24,
        maxPagesPerSource: 120,
        maxRequestsPerSource: 300,
        maxDetailPagesPerSource: 150,
        maxDurationMs: 20 * 60_000,
      };
    case "standard":
    default:
      return {
        targetAcceptedEvents: 150,
        maxRawRecords: 1_000,
        maxSources: 10,
        maxPagesPerSource: 12,
        maxRequestsPerSource: 40,
        maxDetailPagesPerSource: 24,
        maxDurationMs: 2 * 60_000,
      };
  }
}

export function inferDiscoveryBudget(input: CrawlIntentInput | CrawlIntent): DiscoveryBudget {
  const intent = "normalizedQuery" in input ? input : parseCrawlIntent(input);
  const lower = intent.normalizedQuery.toLowerCase();
  const target = intent.targetCountHint;
  let profile: DiscoveryBudget["profile"] = "standard";
  if (/\bexhaustive|complete|all public\b/.test(lower)) profile = "exhaustive";
  else if ((target ?? 0) >= 500 || /\bdeep|500\+|hundreds?\b/.test(lower)) profile = "deep";
  else if ((target ?? 0) > 0 && (target ?? 0) <= 50) profile = "quick";
  else if (intent.prioritizeLatency && !intent.prioritizeCoverage) profile = "quick";

  const base = budgetForProfile(profile);
  const targetAcceptedEvents = target
    ? Math.max(profile === "quick" ? 25 : 75, Math.min(target, base.targetAcceptedEvents))
    : base.targetAcceptedEvents;

  return {
    profile,
    ...base,
    targetAcceptedEvents,
    ...(intent.dateHorizonStart ? { dateHorizonStart: intent.dateHorizonStart } : {}),
    ...(intent.dateHorizonEnd ? { dateHorizonEnd: intent.dateHorizonEnd } : {}),
    prioritizeLatency: intent.prioritizeLatency || profile === "quick",
    prioritizeCoverage: intent.prioritizeCoverage || profile === "deep" || profile === "exhaustive",
  };
}
