import { parseCommand } from "@/agent/parseCommand";
import type { DiscoveryPreferences, DiscoveryProfile, RemotePolicy } from "@/core/discovery/types";

export type QueryInterpretation = {
  theme: string;
  eventLocation: string;
  participantEligibility: string;
  remotePolicy: string;
  dateRange: string;
  sourceRestriction: string;
  crawlProfile: string;
  dryRun: boolean;
  verbose: boolean;
  budgets: {
    devpost: string;
    luma: string;
  };
};

function remotePolicyLabel(policy: RemotePolicy | undefined): string {
  switch (policy) {
    case "only":
      return "remote only";
    case "exclude":
      return "excluded";
    case "inferred_open":
      return "inferred open (eligibility)";
    case "include":
      return "included";
    default:
      return "included";
  }
}

function dateRangeLabel(preferences: DiscoveryPreferences): string {
  if (preferences.dateFrom && preferences.dateTo) {
    return `${preferences.dateFrom} – ${preferences.dateTo}`;
  }
  if (preferences.dateFrom) return `from ${preferences.dateFrom}`;
  if (preferences.dateTo) return `until ${preferences.dateTo}`;
  return "upcoming / inferred horizon";
}

function locationLabel(preferences: DiscoveryPreferences): string {
  if (preferences.locationConstraint === "event_location") {
    return preferences.locations.join(", ") || "unspecified";
  }
  if (preferences.locations.length > 0) {
    return preferences.locations.join(", ");
  }
  return "none";
}

function eligibilityLabel(preferences: DiscoveryPreferences): string {
  if (preferences.locationConstraint === "participant_eligibility") {
    return preferences.locations.join(", ") || "requested regions";
  }
  return "none";
}

/** Keep in sync with collector budget helpers; client-safe (no Playwright imports). */
export function describeProfileBudgets(profile: DiscoveryProfile | undefined): {
  devpost: string;
  luma: string;
} {
  switch (profile) {
    case "exhaustive":
      return {
        devpost: "1000 cards / 150 pages / 120 details",
        luma: "600 events / 120 scrolls / 180 details",
      };
    case "deep":
      return {
        devpost: "500 cards / 80 pages / 80 details",
        luma: "350 events / 80 scrolls / 120 details",
      };
    case "standard":
      return {
        devpost: "180 cards / 35 pages / 36 details",
        luma: "180 events / 45 scrolls / 60 details",
      };
    case "light":
    default:
      return {
        devpost: "100 cards / 20 pages / 18 details",
        luma: "100 events / 30 scrolls / 30 details",
      };
  }
}

export function interpretDiscoveryQuery(input: {
  request: string;
  profile?: "light" | "standard" | "deep" | "exhaustive";
  remotePolicy?: RemotePolicy;
  sources?: string[];
  dryRun?: boolean;
  verbose?: boolean;
}): QueryInterpretation {
  const preferences = parseCommand(input.request);
  const profile = input.profile ?? preferences.profile ?? "standard";
  const remotePolicy = input.remotePolicy ?? preferences.remotePolicy;
  const sourceRestriction =
    input.sources && input.sources.length > 0
      ? input.sources.join(", ")
      : preferences.sources.join(", ");

  return {
    theme: preferences.themes.length > 0 ? preferences.themes.join(", ") : "unspecified",
    eventLocation: locationLabel({
      ...preferences,
      remotePolicy,
    }),
    participantEligibility: eligibilityLabel(preferences),
    remotePolicy: remotePolicyLabel(remotePolicy),
    dateRange: dateRangeLabel(preferences),
    sourceRestriction,
    crawlProfile: profile,
    dryRun: input.dryRun === true,
    verbose: input.verbose === true,
    budgets: describeProfileBudgets(profile),
  };
}

export function formatQueryInterpretationLines(
  interpretation: QueryInterpretation,
): string[] {
  return [
    `[query] Theme: ${interpretation.theme}`,
    `[query] Location: ${interpretation.eventLocation}`,
    `[query] Eligibility: ${interpretation.participantEligibility}`,
    `[query] Remote: ${interpretation.remotePolicy}`,
    `[query] Dates: ${interpretation.dateRange}`,
    `[query] Sources: ${interpretation.sourceRestriction}`,
    `[query] Profile: ${interpretation.crawlProfile}`,
    `[query] Dry-run: ${interpretation.dryRun ? "yes" : "no"}`,
    `[query] Devpost budget: ${interpretation.budgets.devpost}`,
    `[query] Luma budget: ${interpretation.budgets.luma}`,
  ];
}
