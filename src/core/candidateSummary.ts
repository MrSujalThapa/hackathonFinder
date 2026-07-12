import type { HackathonEvent, HackathonEvidence } from "@/core/discovery/types";
import { normalizeText } from "@/core/dedupe";

export type CandidateSummaryPrompt = {
  event: HackathonEvent;
  evidenceText: string;
  maxLength: number;
};

export type CandidateSummaryProvider = {
  readonly name: string;
  summarize(input: CandidateSummaryPrompt): Promise<string>;
};

export type CandidateSummaryResult = {
  summary: string;
  cacheKey: string;
  providerName: string;
  usedFallback: boolean;
  unsupportedTerms: string[];
};

const COMMON_WORDS = new Set([
  "about",
  "across",
  "also",
  "and",
  "apply",
  "build",
  "builder",
  "builders",
  "for",
  "from",
  "hackathon",
  "has",
  "hosted",
  "in",
  "is",
  "join",
  "listed",
  "mode",
  "on",
  "online",
  "open",
  "participants",
  "registration",
  "remote",
  "runs",
  "student",
  "students",
  "the",
  "this",
  "to",
  "with",
]);

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
    .map((item) => [item.url, item.title, item.snippet, item.raw ? JSON.stringify(stableValue(item.raw)) : ""].filter(Boolean).join(" "))
    .join(" ");
}

function supportText(event: HackathonEvent): string {
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
    evidenceText(event.evidence),
  ].filter(Boolean).join(" ");
}

function truncateSentence(value: string, maxLength: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLength) return trimmed;
  const sliced = trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd();
  const lastSpace = sliced.lastIndexOf(" ");
  return `${sliced.slice(0, lastSpace > 60 ? lastSpace : sliced.length).trimEnd()}...`;
}

export function buildCandidateSummaryCacheKey(
  event: HackathonEvent,
  providerName = "deterministic",
): string {
  return `candidate-summary:${hashText(JSON.stringify(stableValue({
    providerName,
    event,
  })))}`;
}

export function deterministicCandidateSummary(
  event: HackathonEvent,
  maxLength = 280,
): string {
  const bits: string[] = [];
  const place =
    event.mode === "online" || event.city === "Remote"
      ? "online"
      : [event.city, event.country].filter(Boolean).join(", ") || event.location || undefined;
  const dates = event.deadline
    ? `registration deadline ${event.deadline}`
    : event.startDate
      ? `starts ${event.startDate}`
      : undefined;
  const themes = event.themes.length > 0 ? `${event.themes.slice(0, 3).join(", ")} focus` : undefined;

  bits.push(event.name);
  if (place) bits.push(place);
  if (themes) bits.push(themes);
  if (dates) bits.push(dates);
  if (event.eligibility) bits.push(event.eligibility);
  if (event.prize) bits.push(event.prize);

  return truncateSentence(bits.join(" - "), maxLength);
}

export function findUnsupportedSummaryTerms(
  summary: string,
  event: HackathonEvent,
): string[] {
  const supported = new Set(
    normalizeText(supportText(event))
      .split(" ")
      .filter(Boolean),
  );
  const unsupported = normalizeText(summary)
    .split(" ")
    .filter((token) => token.length > 3)
    .filter((token) => !COMMON_WORDS.has(token))
    .filter((token) => !supported.has(token));
  return [...new Set(unsupported)];
}

export async function generateCandidateSummary(
  event: HackathonEvent,
  options: {
    provider?: CandidateSummaryProvider;
    maxLength?: number;
  } = {},
): Promise<CandidateSummaryResult> {
  const maxLength = options.maxLength ?? 280;
  const fallback = deterministicCandidateSummary(event, maxLength);

  if (!options.provider) {
    return {
      summary: fallback,
      cacheKey: buildCandidateSummaryCacheKey(event),
      providerName: "deterministic",
      usedFallback: true,
      unsupportedTerms: [],
    };
  }

  let proposed: string;
  try {
    proposed = await options.provider.summarize({
      event,
      evidenceText: supportText(event),
      maxLength,
    });
  } catch {
    proposed = "";
  }

  const summary = truncateSentence(proposed, maxLength);
  const unsupportedTerms = summary
    ? findUnsupportedSummaryTerms(summary, event)
    : ["empty"];

  if (unsupportedTerms.length > 0) {
    return {
      summary: fallback,
      cacheKey: buildCandidateSummaryCacheKey(event, options.provider.name),
      providerName: options.provider.name,
      usedFallback: true,
      unsupportedTerms,
    };
  }

  return {
    summary,
    cacheKey: buildCandidateSummaryCacheKey(event, options.provider.name),
    providerName: options.provider.name,
    usedFallback: false,
    unsupportedTerms: [],
  };
}
