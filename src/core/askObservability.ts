import type { QuestionKind } from "@/core/candidateAskDecision";

/**
 * Safe Ask debug meta — no secrets, prompts, or chain-of-thought.
 * Attached under API `data.meta` for local/dev inspection.
 */
export type AskObservabilityMeta = {
  questionType: QuestionKind;
  llmAttempted: boolean;
  llmSucceeded: boolean;
  fallbackUsed: boolean;
  model?: string;
  latencyMs?: number;
  researchCalls: number;
};

export type AskObservabilityInput = {
  questionType: QuestionKind;
  llmAttempted?: boolean;
  llmSucceeded?: boolean;
  fallbackUsed?: boolean;
  model?: string | null;
  latencyMs?: number | null;
  researchCalls?: number;
};

export function buildAskObservabilityMeta(
  input: AskObservabilityInput,
): AskObservabilityMeta {
  const meta: AskObservabilityMeta = {
    questionType: input.questionType,
    llmAttempted: Boolean(input.llmAttempted),
    llmSucceeded: Boolean(input.llmSucceeded),
    fallbackUsed: Boolean(input.fallbackUsed),
    researchCalls: Math.max(0, Math.floor(input.researchCalls ?? 0)),
  };

  if (typeof input.model === "string" && input.model.trim()) {
    meta.model = input.model.trim().slice(0, 80);
  }
  if (
    typeof input.latencyMs === "number" &&
    Number.isFinite(input.latencyMs) &&
    input.latencyMs >= 0
  ) {
    meta.latencyMs = Math.round(input.latencyMs);
  }

  return meta;
}
