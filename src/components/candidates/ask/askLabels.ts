import type {
  DecisionRecommendationLevel,
  FactCertainty,
} from "@/core/candidateAskDecision";

export type ConfidenceLevel = "high" | "medium" | "low";

/** Step 9 plain-language confidence. Omits when confidence is absent. */
export function confidenceLabel(
  confidence: ConfidenceLevel | string | null | undefined,
): string | null {
  if (confidence === "high") return "High confidence";
  if (confidence === "medium") return "Moderate confidence";
  if (confidence === "low") return "Limited evidence";
  return null;
}

/** Plain-language certainty for factual answers. */
export function certaintyLabel(
  certainty: FactCertainty | "likely" | "unclear" | string | null | undefined,
): string | null {
  if (certainty === "confirmed") return "Confirmed";
  if (certainty === "inferred") return "Inferred";
  if (certainty === "likely") return "Likely";
  if (certainty === "conflicting") return "Conflicting";
  if (certainty === "unknown" || certainty === "unclear") return "Unclear";
  return null;
}

/**
 * Evidence path label. Live when verified live; otherwise optional stored note.
 * Never show both.
 */
export function evidenceStatusLabel(
  liveVerification: boolean,
  options?: { showStored?: boolean },
): string | null {
  if (liveVerification) return "Live verification used";
  if (options?.showStored) return "Based on stored evidence";
  return null;
}

export function recommendationLabel(
  level: DecisionRecommendationLevel,
): string {
  return level.replace(/_/g, " ");
}

/** Restrained stamp tone by recommendation level (not SaaS pills). */
export function recommendationStampStyle(
  level: DecisionRecommendationLevel,
): { color: string; borderColor: string } {
  if (level === "strong_yes" || level === "yes") {
    return {
      color: "color-mix(in oklab, var(--accent-approve) 88%, white)",
      borderColor: "color-mix(in oklab, var(--accent-approve) 45%, transparent)",
    };
  }
  if (level === "no" || level === "strong_no") {
    return {
      color: "color-mix(in oklab, var(--accent-reject) 92%, white)",
      borderColor: "color-mix(in oklab, var(--accent-reject) 45%, transparent)",
    };
  }
  return {
    color: "color-mix(in oklab, var(--accent-warn) 90%, white)",
    borderColor: "color-mix(in oklab, var(--accent-warn) 40%, transparent)",
  };
}

