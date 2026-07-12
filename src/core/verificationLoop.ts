import type {
  HackathonEvent,
  HackathonEvidence,
  VerificationResult,
} from "@/core/discovery/types";
import type { MissingFact } from "@/core/findMissingFacts";
import { findMissingFacts } from "@/core/findMissingFacts";
import { normalizeDatePart, normalizeUrl } from "@/core/dedupe";
import {
  synthesizeGroundedVerification,
  type LlmVerificationProvider,
} from "@/core/llmVerify";

export type VerificationSearchRequest = {
  event: HackathonEvent;
  missingFact: MissingFact;
  query: string;
  maxResults: number;
};

export type VerificationToolHit = {
  title?: string;
  url?: string;
  snippet?: string;
  evidence?: HackathonEvidence;
  facts?: Partial<HackathonEvent>;
};

export type VerificationSearchEnrichTool = {
  readonly name: string;
  search(input: VerificationSearchRequest): Promise<VerificationToolHit[]>;
  enrich?(input: {
    event: HackathonEvent;
    missingFact: MissingFact;
    hit: VerificationToolHit;
  }): Promise<VerificationToolHit>;
};

export type VerificationLoopIteration = {
  index: number;
  missingFacts: MissingFact[];
  queries: string[];
  evidenceAdded: number;
  factsAdded: string[];
};

export type VerificationLoopResult = {
  event: HackathonEvent;
  verification: VerificationResult;
  iterations: VerificationLoopIteration[];
  missingFacts: MissingFact[];
  warnings: string[];
  cacheKey: string;
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

function toEvidence(hit: VerificationToolHit): HackathonEvidence | undefined {
  if (hit.evidence) return hit.evidence;
  if (!hit.url && !hit.title && !hit.snippet) return undefined;
  return {
    type: "search_result",
    url: hit.url,
    title: hit.title,
    snippet: hit.snippet,
    raw: {},
  };
}

function supportText(evidence: HackathonEvidence[]): string {
  return evidence
    .map((item) => [item.url, item.title, item.snippet, item.raw ? JSON.stringify(item.raw) : ""].filter(Boolean).join(" "))
    .join(" ")
    .toLowerCase();
}

function factSupported(
  field: keyof HackathonEvent,
  value: unknown,
  evidence: HackathonEvidence[],
): boolean {
  if (value === undefined || value === null) return false;
  const text = supportText(evidence);
  const values = Array.isArray(value) ? value : [value];

  return values.some((entry) => {
    const stringValue = String(entry).trim();
    if (!stringValue) return false;
    if (field === "officialUrl" || field === "applyUrl" || field === "socialUrl") {
      const normalized = normalizeUrl(stringValue);
      return evidence.some((item) => normalizeUrl(item.url) === normalized) || text.includes(stringValue.toLowerCase());
    }
    if (field === "startDate" || field === "endDate" || field === "deadline") {
      const normalized = normalizeDatePart(stringValue) ?? stringValue;
      return text.includes(normalized.toLowerCase()) || text.includes(stringValue.toLowerCase());
    }
    return stringValue
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 2)
      .every((token) => text.includes(token));
  });
}

function mergeSupportedFacts(
  event: HackathonEvent,
  facts: Partial<HackathonEvent> | undefined,
  evidence: HackathonEvidence[],
): string[] {
  if (!facts) return [];
  const added: string[] = [];
  const mutable = event as unknown as Record<string, unknown>;

  for (const [field, value] of Object.entries(facts) as Array<[keyof HackathonEvent, unknown]>) {
    if (field === "evidence" || field === "source" || field === "sourceIds") continue;
    if (mutable[field as string] !== undefined && mutable[field as string] !== "" && !(Array.isArray(mutable[field as string]) && (mutable[field as string] as unknown[]).length === 0)) {
      continue;
    }
    if (factSupported(field, value, evidence)) {
      mutable[field as string] = value;
      added.push(String(field));
    }
  }

  return added;
}

export function buildVerificationLoopCacheKey(
  event: HackathonEvent,
  toolName = "none",
): string {
  return `verification-loop:${hashText(JSON.stringify(stableValue({ event, toolName })))}`;
}

export async function runVerificationLoop(
  event: HackathonEvent,
  options: {
    tool?: VerificationSearchEnrichTool;
    verificationProvider?: LlmVerificationProvider;
    maxIterations?: number;
    maxQueriesPerIteration?: number;
    maxResultsPerQuery?: number;
    now?: Date;
  } = {},
): Promise<VerificationLoopResult> {
  const current: HackathonEvent = {
    ...event,
    themes: [...event.themes],
    evidence: [...event.evidence],
  };
  const warnings: string[] = [];
  const iterations: VerificationLoopIteration[] = [];
  const maxIterations = options.maxIterations ?? 2;
  const maxQueriesPerIteration = options.maxQueriesPerIteration ?? 2;
  const maxResultsPerQuery = options.maxResultsPerQuery ?? 3;

  for (let index = 0; index < maxIterations; index += 1) {
    const missingFacts = findMissingFacts(current).filter((fact) => fact.priority !== "low");
    if (missingFacts.length === 0 || !options.tool) break;

    const queries = missingFacts
      .flatMap((fact) => fact.searchQueries.map((query) => ({ fact, query })))
      .slice(0, maxQueriesPerIteration);
    let evidenceAdded = 0;
    const factsAdded: string[] = [];

    for (const { fact, query } of queries) {
      try {
        const hits = await options.tool.search({
          event: current,
          missingFact: fact,
          query,
          maxResults: maxResultsPerQuery,
        });

        for (const rawHit of hits.slice(0, maxResultsPerQuery)) {
          const hit = options.tool.enrich
            ? await options.tool.enrich({ event: current, missingFact: fact, hit: rawHit })
            : rawHit;
          const evidence = toEvidence(hit);
          if (evidence) {
            current.evidence.push(evidence);
            evidenceAdded += 1;
          }
          factsAdded.push(...mergeSupportedFacts(current, hit.facts, current.evidence));
        }
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : "Verification search failed");
      }
    }

    iterations.push({
      index,
      missingFacts,
      queries: queries.map((entry) => entry.query),
      evidenceAdded,
      factsAdded: [...new Set(factsAdded)],
    });

    if (evidenceAdded === 0 && factsAdded.length === 0) break;
  }

  const verification = await synthesizeGroundedVerification(current, {
    provider: options.verificationProvider,
    now: options.now,
  });

  return {
    event: current,
    verification,
    iterations,
    missingFacts: findMissingFacts(current),
    warnings,
    cacheKey: buildVerificationLoopCacheKey(current, options.tool?.name ?? "none"),
  };
}
