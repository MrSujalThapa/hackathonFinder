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

export type DecisionReasonBasis =
  | "verified"
  | "inferred"
  | "generic"
  | "missing";

export type DecisionReason = {
  text: string;
  basis: DecisionReasonBasis;
};

export type DecisionRecommendation = {
  recommendation: DecisionRecommendationLevel;
  headline: string;
  /** Short advisory summary (1–2 sentences). */
  summary: string;
  reasons: DecisionReason[];
  concerns: string[];
  missingInformation: string[];
  nextStep: string;
  confidence: "high" | "medium" | "low";
  citations: CandidateAnswerSource[];
};

/** Compact structured factual payload for Ask UI / persistence. */
export type FactualAnswerPayload = {
  answer: string;
  certainty: FactCertainty;
  supportingFacts: string[];
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

export const REASON_BASIS_LEVELS = [
  "verified",
  "inferred",
  "generic",
  "missing",
] as const;

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

export function reasonText(reason: DecisionReason | string): string {
  if (typeof reason === "string") return reason.trim();
  return reason.text.trim();
}

export function asDecisionReasons(value: unknown): DecisionReason[] {
  if (!Array.isArray(value)) return [];
  const out: DecisionReason[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      out.push({ text: item.trim(), basis: "inferred" });
    } else if (item && typeof item === "object") {
      const row = item as { text?: unknown; basis?: unknown };
      if (typeof row.text !== "string" || !row.text.trim()) continue;
      const basis = REASON_BASIS_LEVELS.includes(
        row.basis as DecisionReasonBasis,
      )
        ? (row.basis as DecisionReasonBasis)
        : "inferred";
      out.push({ text: row.text.trim(), basis });
    }
    if (out.length >= 8) break;
  }
  return out;
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

  const headline =
    typeof row.headline === "string" && row.headline.trim()
      ? row.headline.trim()
      : "Advisory recommendation";
  const summary =
    typeof row.summary === "string" && row.summary.trim()
      ? row.summary.trim()
      : headline;

  return {
    recommendation,
    headline,
    summary,
    reasons: asDecisionReasons(row.reasons),
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

export function parseFactualAnswerPayload(
  value: unknown,
  fallbackCitations: CandidateAnswerSource[] = [],
): FactualAnswerPayload | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.answer !== "string" || !row.answer.trim()) return null;
  const certainty: FactCertainty =
    row.certainty === "confirmed" ||
    row.certainty === "inferred" ||
    row.certainty === "conflicting" ||
    row.certainty === "unknown"
      ? row.certainty
      : "unknown";
  return {
    answer: row.answer.trim(),
    certainty,
    supportingFacts: asStringArray(row.supportingFacts),
    citations: asCitations(row.citations, fallbackCitations),
  };
}

export function formatDecisionAnswer(decision: DecisionRecommendation): string {
  const label = decision.recommendation.replace(/_/g, " ");
  const reasonLines = decision.reasons.map(reasonText).filter(Boolean);
  const parts = [
    `${decision.headline} (Recommendation: ${label}.)`,
    decision.summary && decision.summary !== decision.headline
      ? decision.summary
      : null,
    reasonLines.length ? `Why: ${reasonLines.join("; ")}` : null,
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
  factual: FactualAnswerPayload | null;
  links: CandidateAnswerSource[];
  liveVerification: boolean;
  certainty: FactCertainty | null;
} {
  const empty = {
    kind: null as QuestionKind | null,
    decision: null as DecisionRecommendation | null,
    factual: null as FactualAnswerPayload | null,
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
    factual?: unknown;
    liveVerification?: unknown;
    certainty?: unknown;
  };

  const kind =
    row.kind === "factual" || row.kind === "decision" ? row.kind : null;
  const links = asCitations(row.links, []);
  const decision =
    row.decision && typeof row.decision === "object"
      ? parseDecisionRecommendation(row.decision, links)
      : null;
  const factual = parseFactualAnswerPayload(row.factual, links);

  return {
    kind,
    decision,
    factual,
    links,
    liveVerification: Boolean(row.liveVerification),
    certainty:
      row.certainty === "confirmed" ||
      row.certainty === "inferred" ||
      row.certainty === "conflicting" ||
      row.certainty === "unknown"
        ? row.certainty
        : factual?.certainty ?? null,
  };
}
