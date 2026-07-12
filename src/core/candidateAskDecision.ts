export type CandidateAnswerSource = {
  url: string;
  label: string;
};

export type FactCertainty = "confirmed" | "inferred" | "conflicting" | "unknown";

export type QuestionKind = "factual" | "decision";

export type DecisionRecommendationLevel =
  | "strong_yes"
  | "yes"
  | "maybe"
  | "no"
  | "strong_no";

export type DecisionRecommendation = {
  recommendation: DecisionRecommendationLevel;
  headline: string;
  reasons: string[];
  concerns: string[];
  missingInformation: string[];
  nextStep: string;
  confidence: "high" | "medium" | "low";
  citations: CandidateAnswerSource[];
};

export const DECISION_LEVELS = [
  "strong_yes",
  "yes",
  "maybe",
  "no",
  "strong_no",
] as const;

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;

/**
 * Route factual vs decision/advisory without a fixed allowlist.
 * Decision language wins when mixed with factual cues.
 */
export function classifyCandidateQuestion(question: string): QuestionKind {
  const lower = question.toLowerCase().trim();
  if (!lower) return "factual";

  const decisionSignals =
    /\b(should i|should we|worth( my| the)? time|is it worth|recommend|advice|advise|fit(s)? (me|my)|good (fit|idea)|portfolio|career|risks?|trade[- ]?offs?|go for it|pass on|skip (this|it)|commit to|invest (in|time)|priorit[yz]e|compare.*(hack|event)|decide|decision|advisory)\b/i.test(
      lower,
    ) ||
    /^(should|would you|do you think|is this (a )?(good|bad)|worth)\b/i.test(
      lower,
    );

  if (decisionSignals) return "decision";
  return "factual";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function asCitations(
  value: unknown,
  fallback: CandidateAnswerSource[],
): CandidateAnswerSource[] {
  if (!Array.isArray(value)) return fallback.slice(0, 6);
  const parsed = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as { url?: unknown; label?: unknown };
      if (typeof row.url !== "string" || !row.url.trim()) return null;
      return {
        url: row.url.trim(),
        label:
          typeof row.label === "string" && row.label.trim()
            ? row.label.trim()
            : "Source",
      };
    })
    .filter((item): item is CandidateAnswerSource => Boolean(item));
  return (parsed.length ? parsed : fallback).slice(0, 6);
}

export function parseDecisionRecommendation(
  value: unknown,
  fallbackCitations: CandidateAnswerSource[],
): DecisionRecommendation {
  const row =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const recommendation = DECISION_LEVELS.includes(
    row.recommendation as DecisionRecommendationLevel,
  )
    ? (row.recommendation as DecisionRecommendationLevel)
    : "maybe";
  const confidence = CONFIDENCE_LEVELS.includes(
    row.confidence as DecisionRecommendation["confidence"],
  )
    ? (row.confidence as DecisionRecommendation["confidence"])
    : "low";

  return {
    recommendation,
    headline:
      typeof row.headline === "string" && row.headline.trim()
        ? row.headline.trim()
        : "Advisory recommendation",
    reasons: asStringArray(row.reasons),
    concerns: asStringArray(row.concerns),
    missingInformation: asStringArray(row.missingInformation),
    nextStep:
      typeof row.nextStep === "string" && row.nextStep.trim()
        ? row.nextStep.trim()
        : "Verify details on the official event page before deciding.",
    confidence,
    citations: asCitations(row.citations, fallbackCitations),
  };
}

export function formatDecisionAnswer(decision: DecisionRecommendation): string {
  const label = decision.recommendation.replace(/_/g, " ");
  const parts = [
    `${decision.headline} (Recommendation: ${label}.)`,
    decision.reasons.length ? `Why: ${decision.reasons.join("; ")}` : null,
    decision.concerns.length ? `Concerns: ${decision.concerns.join("; ")}` : null,
    decision.missingInformation.length
      ? `Missing: ${decision.missingInformation.join("; ")}`
      : null,
    `Next step: ${decision.nextStep}`,
  ].filter(Boolean);
  return parts.join(" ");
}

/** Parse a persisted answer's sources blob for UI rendering. */
export function readPersistedAskPayload(sources: unknown): {
  kind: QuestionKind | null;
  decision: DecisionRecommendation | null;
  links: CandidateAnswerSource[];
  liveVerification: boolean;
  certainty: FactCertainty | null;
} {
  const empty = {
    kind: null as QuestionKind | null,
    decision: null as DecisionRecommendation | null,
    links: [] as CandidateAnswerSource[],
    liveVerification: false,
    certainty: null as FactCertainty | null,
  };
  if (!sources || typeof sources !== "object") return empty;

  if (Array.isArray(sources)) {
    return {
      ...empty,
      links: asCitations(sources, []),
    };
  }

  const row = sources as {
    links?: unknown;
    kind?: unknown;
    decision?: unknown;
    liveVerification?: unknown;
    certainty?: unknown;
  };

  const kind =
    row.kind === "factual" || row.kind === "decision" ? row.kind : null;
  const decision =
    row.decision && typeof row.decision === "object"
      ? parseDecisionRecommendation(row.decision, asCitations(row.links, []))
      : null;

  return {
    kind,
    decision,
    links: asCitations(row.links, []),
    liveVerification: Boolean(row.liveVerification),
    certainty:
      row.certainty === "confirmed" ||
      row.certainty === "inferred" ||
      row.certainty === "conflicting" ||
      row.certainty === "unknown"
        ? row.certainty
        : null,
  };
}
