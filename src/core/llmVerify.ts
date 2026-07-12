import type {
  HackathonEvent,
  HackathonEvidence,
  VerificationResult,
} from "@/core/discovery/types";
import { normalizeText } from "@/core/dedupe";
import { verifyHackathonEvent } from "@/core/verify";

export type VerificationClaim = {
  text: string;
  quote?: string;
  url?: string;
};

export type LlmVerificationOutput = {
  status?: VerificationResult["status"];
  confidence?: VerificationResult["confidence"];
  valid?: boolean;
  reasons?: VerificationClaim[] | string[];
  redFlags?: VerificationClaim[] | string[];
};

export type LlmVerificationPrompt = {
  event: HackathonEvent;
  evidenceText: string;
};

export type LlmVerificationProvider = {
  readonly name: string;
  verify(input: LlmVerificationPrompt): Promise<string | LlmVerificationOutput>;
};

export type GroundedVerificationResult = VerificationResult & {
  supportedClaims: string[];
  unsupportedClaims: string[];
  cacheKey: string;
  providerName: string;
  usedFallback: boolean;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function evidenceText(evidence: HackathonEvidence[]): string {
  return evidence
    .map((item) =>
      [
        item.url,
        item.title,
        item.snippet,
        item.raw ? JSON.stringify(stableValue(item.raw)) : "",
      ].filter(Boolean).join(" "),
    )
    .join(" ");
}

function eventFactText(event: HackathonEvent): string {
  return [
    event.name,
    event.officialUrl,
    event.applyUrl,
    event.socialUrl,
    event.startDate,
    event.endDate,
    event.deadline,
    event.location,
    event.mode,
    event.city,
    event.country,
    event.prize,
    event.themes.join(" "),
    event.eligibility,
    event.description,
  ].filter(Boolean).join(" ");
}

function parseProviderOutput(raw: string | LlmVerificationOutput): LlmVerificationOutput {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (!trimmed) return {};
  const jsonFence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse(jsonFence?.[1] ?? trimmed) as LlmVerificationOutput;
}

function claimText(claim: VerificationClaim | string): string {
  return typeof claim === "string" ? claim : claim.text;
}

function claimSupported(
  claim: VerificationClaim | string,
  supportText: string,
): boolean {
  const text = claimText(claim);
  if (!text.trim()) return false;

  if (typeof claim !== "string") {
    if (claim.quote && supportText.toLowerCase().includes(claim.quote.toLowerCase())) {
      return true;
    }
    if (claim.url && supportText.includes(claim.url)) {
      return true;
    }
  }

  const tokens = normalizeText(text)
    .split(" ")
    .filter((token) => token.length > 3);
  if (tokens.length === 0) return true;
  return tokens.some((token) => normalizeText(supportText).includes(token));
}

function deterministicResult(event: HackathonEvent, now?: Date): GroundedVerificationResult {
  const base = verifyHackathonEvent(event, { now });
  return {
    ...base,
    supportedClaims: [...base.reasons, ...base.redFlags],
    unsupportedClaims: [],
    cacheKey: buildLlmVerificationCacheKey(event, "deterministic"),
    providerName: "deterministic",
    usedFallback: true,
  };
}

export function buildLlmVerificationCacheKey(
  event: HackathonEvent,
  providerName = "deterministic",
): string {
  return `llm-verify:${hashText(JSON.stringify(stableValue({
    providerName,
    event,
  })))}`;
}

export async function synthesizeGroundedVerification(
  event: HackathonEvent,
  options: { provider?: LlmVerificationProvider; now?: Date } = {},
): Promise<GroundedVerificationResult> {
  if (!options.provider) {
    return deterministicResult(event, options.now);
  }

  const supportText = [eventFactText(event), evidenceText(event.evidence)].join(" ");
  let output: LlmVerificationOutput;
  try {
    output = parseProviderOutput(
      await options.provider.verify({
        event,
        evidenceText: supportText,
      }),
    );
  } catch {
    return deterministicResult(event, options.now);
  }

  const reasons = output.reasons ?? [];
  const redFlags = output.redFlags ?? [];
  const supportedReasons = reasons.filter((claim) => claimSupported(claim, supportText)).map(claimText);
  const supportedRedFlags = redFlags.filter((claim) => claimSupported(claim, supportText)).map(claimText);
  const unsupportedClaims = [...reasons, ...redFlags]
    .filter((claim) => !claimSupported(claim, supportText))
    .map(claimText);

  if (supportedReasons.length === 0 && supportedRedFlags.length === 0) {
    return {
      ...deterministicResult(event, options.now),
      unsupportedClaims,
      providerName: options.provider.name,
    };
  }

  const fallback = verifyHackathonEvent(event, { now: options.now });
  const status = output.status ?? fallback.status;
  const confidence =
    unsupportedClaims.length > 0 && output.confidence === "high"
      ? "medium"
      : output.confidence ?? fallback.confidence;

  return {
    valid: output.valid ?? status !== "rejected",
    status,
    confidence,
    reasons: supportedReasons,
    redFlags: supportedRedFlags,
    supportedClaims: [...supportedReasons, ...supportedRedFlags],
    unsupportedClaims,
    cacheKey: buildLlmVerificationCacheKey(event, options.provider.name),
    providerName: options.provider.name,
    usedFallback: false,
  };
}
