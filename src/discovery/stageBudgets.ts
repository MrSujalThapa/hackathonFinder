/**
 * Profile-level stage budget guidance for discovery runs.
 * Listing budgets remain source-owned; these do not cancel correct work.
 */

import type { DiscoveryProfile } from "@/core/discovery/types";

export type DiscoveryStageName =
  | "planning"
  | "listing"
  | "triage"
  | "enrichment"
  | "verification"
  | "persistence";

export type StageBudgetGuidance = {
  profile: DiscoveryProfile;
  /** Soft guidance only — never steal listing capacity for enrichment. */
  preferFastListing: boolean;
  /** Soft max wall time hint for shared enrichment stage (ms). */
  enrichmentTimeoutMs: number;
  /** Soft max pages for shared enrichPromisingLeads. */
  enrichmentMaxPages: number;
  /** Shared enrichment concurrency (bounded). */
  enrichmentConcurrency: number;
  /** Soft hint that persistence should finish promptly after records exist. */
  persistenceCompletionHintMs: number;
  notes: string[];
};

const BY_PROFILE: Record<DiscoveryProfile, Omit<StageBudgetGuidance, "profile">> = {
  light: {
    preferFastListing: true,
    enrichmentTimeoutMs: 6_000,
    enrichmentMaxPages: 8,
    enrichmentConcurrency: 3,
    persistenceCompletionHintMs: 15_000,
    notes: [
      "Favor fast listing and limited high-value enrichment",
      "Return progressive results quickly",
    ],
  },
  standard: {
    preferFastListing: false,
    enrichmentTimeoutMs: 10_000,
    enrichmentMaxPages: 15,
    enrichmentConcurrency: 4,
    persistenceCompletionHintMs: 30_000,
    notes: ["Balanced listing and enrichment"],
  },
  deep: {
    preferFastListing: false,
    enrichmentTimeoutMs: 12_000,
    enrichmentMaxPages: 20,
    enrichmentConcurrency: 4,
    persistenceCompletionHintMs: 45_000,
    notes: [
      "Preserve full configured listing targets",
      "Larger detail budget after listing (source-owned)",
    ],
  },
  exhaustive: {
    preferFastListing: false,
    enrichmentTimeoutMs: 15_000,
    enrichmentMaxPages: 25,
    enrichmentConcurrency: 4,
    persistenceCompletionHintMs: 60_000,
    notes: ["Continue under explicit hard safety limits"],
  },
};

export function stageBudgetForProfile(
  profile: DiscoveryProfile | null | undefined,
): StageBudgetGuidance {
  const key = profile && profile in BY_PROFILE ? profile : "standard";
  return { profile: key as DiscoveryProfile, ...BY_PROFILE[key as DiscoveryProfile] };
}

export function compactStageBudget(guidance: StageBudgetGuidance): Record<string, unknown> {
  return {
    profile: guidance.profile,
    preferFastListing: guidance.preferFastListing,
    enrichmentTimeoutMs: guidance.enrichmentTimeoutMs,
    enrichmentMaxPages: guidance.enrichmentMaxPages,
    enrichmentConcurrency: guidance.enrichmentConcurrency,
    persistenceCompletionHintMs: guidance.persistenceCompletionHintMs,
  };
}
