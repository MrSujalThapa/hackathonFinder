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
        devpost: "target 1000 / max 2500 cards / 320 pages / 160 details",
        luma: "target 200 / max 1200 events / 180 scrolls / 180 details",
      };
    case "deep":
      return {
        devpost: "target ≥300 / max 500 cards / 90 pages / 80 details",
        luma: "target ≥100 / max 400 events / 100 scrolls / 80 details",
      };
    case "standard":
      return {
        devpost: "target 200 / max 250 cards / 40 pages / 24 details",
        luma: "target 100 / max 200 events / 50 scrolls / 40 details",
      };
    case "light":
    default:
      return {
        devpost: "target 75 / max 100 cards / 14 pages / 8 details",
        luma: "target 40 / max 80 events / 20 scrolls / 12 details",
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
