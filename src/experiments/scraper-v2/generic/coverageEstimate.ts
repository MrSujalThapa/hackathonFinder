import * as cheerio from "cheerio";
import type {
  AcquiredArtifact,
  AcquisitionDiagnostics,
  CandidateRecordSet,
  GenericShadowLead,
} from "@/experiments/scraper-v2/generic/types";

export type AvailableEstimateMethod =
  | "api_total"
  | "visible_count"
  | "pagination_derived"
  | "inferred"
  | "unknown";

export type AvailableEstimateConfidence = "authoritative" | "strong" | "inferred" | "unknown";

export type AvailableCountEstimate = {
  estimatedAvailableRecords?: number;
  method: AvailableEstimateMethod;
  confidence: AvailableEstimateConfidence;
  evidence: string[];
  contradictions: string[];
};

type CandidateEstimate = AvailableCountEstimate & { priority: number };

function htmlFromArtifact(artifact: AcquiredArtifact): string | undefined {
  if (artifact.kind !== "html" && artifact.kind !== "dom_snapshot") return undefined;
  const payload = artifact.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const html = (payload as Record<string, unknown>).html;
  return typeof html === "string" ? html : undefined;
}

function eventPayloadScore(value: unknown): number {
  const text = JSON.stringify(value).slice(0, 20_000).toLowerCase();
  let score = 0;
  if (/\b(hackathon|challenge|event|competition|summit|workshop)\b/.test(text)) score += 3;
  if (/\b(title|name|url|href|slug)\b/.test(text)) score += 1;
  if (/\b(start|date|deadline|submission|open|upcoming|location|venue)\b/.test(text)) score += 2;
  if (/\b(sponsor|sponsorship|question|answer|form|field|filter)\b/.test(text)) score -= 3;
  return score;
}

function collectApiTotals(artifacts: AcquiredArtifact[]): CandidateEstimate[] {
  const out: CandidateEstimate[] = [];
  const apiKinds = new Set(["network_json", "next_data", "router_data", "embedded_json", "json_ld"]);
  function inspect(value: unknown, path: string, depth: number): void {
    if (depth > 6 || value == null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.slice(0, 8).forEach((item, index) => inspect(item, `${path}[${index}]`, depth + 1));
      return;
    }
    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      if (/^(total|total_count|totalCount|totalResults|total_records|available|count)$/i.test(key) && typeof child === "number" && child > 0) {
        const nearbyScore = eventPayloadScore(record);
        if (nearbyScore >= 4) {
          out.push({
            estimatedAvailableRecords: Math.round(child),
            method: "api_total",
            confidence: "authoritative",
            evidence: [`structured total ${path ? `${path}.` : ""}${key}=${child}`],
            contradictions: [],
            priority: 1,
          });
        }
      }
      if (/^(visualNodes|nodes|edges|children|screenshots?|boundingBoxes?)$/i.test(key)) continue;
      inspect(child, path ? `${path}.${key}` : key, depth + 1);
    }
  }
  for (const artifact of artifacts) {
    if (!apiKinds.has(artifact.kind)) continue;
    inspect(artifact.payload, artifact.artifactId, 0);
  }
  return out;
}

function collectVisibleCounts(artifacts: AcquiredArtifact[]): CandidateEstimate[] {
  const out: CandidateEstimate[] = [];
  for (const artifact of artifacts) {
    const html = htmlFromArtifact(artifact);
    if (!html) continue;
    const $ = cheerio.load(html);
    const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 30_000);
    const matches = [...text.matchAll(/\b(?:showing\s+)?(?:all\s+)?(\d{1,5})\s+(?:public\s+)?(?:hackathons|events|challenges|competitions|results)\b/gi)];
    for (const match of matches.slice(0, 5)) {
      const count = Number(match[1]);
      if (!Number.isInteger(count) || count <= 0) continue;
      if (count >= 1900 && count <= 2099) continue;
      out.push({
        estimatedAvailableRecords: count,
        method: "visible_count",
        confidence: "strong",
        evidence: [`visible count label "${match[0]}" in ${artifact.artifactId}`],
        contradictions: [],
        priority: 2,
      });
    }
    $("table").each((_tableIndex, table) => {
      const rows = $(table)
        .find("tbody tr, tr")
        .toArray()
        .filter((row) => {
          const text = $(row).text().replace(/\s+/g, " ").trim();
          if (text.length < 12) return false;
          const cells = $(row).find("td,th").length;
          if (cells < 2) return false;
          return /\b(hackathon|challenge|event|deadline|register|apply|prize|online|virtual|in-person|hybrid|20\d{2})\b/i.test(text);
        });
      if (rows.length >= 5) {
        out.push({
          estimatedAvailableRecords: rows.length,
          method: "visible_count",
          confidence: "strong",
          evidence: [`visible table has ${rows.length} event-like rows in ${artifact.artifactId}`],
          contradictions: [],
          priority: 2,
        });
      }
    });
  }
  return out;
}

function collectPaginationEstimate(input: {
  artifacts: AcquiredArtifact[];
  observedValidEvents: number;
  diagnostics?: AcquisitionDiagnostics;
}): CandidateEstimate[] {
  const out: CandidateEstimate[] = [];
  const maxScrollCardCount = Math.max(0, ...(input.diagnostics?.scrollTrace ?? []).map((item) => item.cardCount));
  const acceptedActions = (input.diagnostics?.actionTrace ?? []).filter((item) => item.accepted).length;
  if (
    input.diagnostics?.paginationStopReason === "no_growth" &&
    acceptedActions < 2 &&
    maxScrollCardCount >= input.observedValidEvents + 10
  ) {
    out.push({
      estimatedAvailableRecords: maxScrollCardCount,
      method: "visible_count",
      confidence: "inferred",
      evidence: [`browser scroll probe observed ${maxScrollCardCount} event-like visible containers`],
      contradictions: [],
      priority: 2,
    });
  }
  if (input.diagnostics?.paginationStopReason === "no_growth" && input.observedValidEvents > 0) {
    out.push({
      estimatedAvailableRecords: input.observedValidEvents,
      method: "pagination_derived",
      confidence: "strong",
      evidence: [`source exhausted after pagination with ${input.observedValidEvents} unique valid events observed`],
      contradictions: [],
      priority: 3,
    });
  }

  for (const artifact of input.artifacts) {
    const html = htmlFromArtifact(artifact);
    if (!html) continue;
    const $ = cheerio.load(html);
    const pageNumbers = $("a,button,[role='button'],[aria-label]")
      .toArray()
      .filter((element) => {
        const item = $(element);
        const tag = element.tagName.toLowerCase();
        const role = item.attr("role");
        const aria = item.attr("aria-label") ?? "";
        const href = item.attr("href") ?? "";
        const text = item.text().replace(/\s+/g, " ").trim();
        return tag === "button" ||
          role === "button" ||
          /\bpage\b/i.test(aria) ||
          /(?:[?&](page|p)=|\/page\/\d+)/i.test(href) ||
          (/^\d{1,3}$/.test(text) && item.parents("nav,[aria-label*='pagination' i]").length > 0);
      })
      .flatMap((element) => [$(element).attr("aria-label"), $(element).text()])
      .map((value) => value?.replace(/\s+/g, " ").trim() ?? "")
      .map((value) => value.match(/\b(?:page\s*)?(\d{1,3})\b/i)?.[1])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0 && value <= 100);
    const maxPage = Math.max(0, ...pageNumbers);
    if (maxPage >= 2 && input.observedValidEvents > 0) {
      const pagesSeen = Math.max(1, input.diagnostics?.browserPages ?? 1);
      const observedPerPage = Math.ceil(input.observedValidEvents / pagesSeen);
      out.push({
        estimatedAvailableRecords: Math.max(input.observedValidEvents, maxPage * observedPerPage),
        method: "pagination_derived",
        confidence: "strong",
        evidence: [`pagination controls expose ${maxPage} pages; observed ${input.observedValidEvents} valid events over ${pagesSeen} pages`],
        contradictions: [],
        priority: 3,
      });
    }
  }
  return out;
}

function contradictionMessages(candidates: CandidateEstimate[]): string[] {
  const withCounts = candidates.filter((candidate) => candidate.estimatedAvailableRecords !== undefined);
  const messages: string[] = [];
  for (let leftIndex = 0; leftIndex < withCounts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < withCounts.length; rightIndex += 1) {
      const left = withCounts[leftIndex];
      const right = withCounts[rightIndex];
      const a = left.estimatedAvailableRecords ?? 0;
      const b = right.estimatedAvailableRecords ?? 0;
      if (Math.max(a, b) >= Math.min(a, b) * 1.5 + 10) {
        messages.push(`${left.method}=${a} disagrees with ${right.method}=${b}`);
      }
    }
  }
  return [...new Set(messages)];
}

export function estimateAvailableEventCount(input: {
  artifacts: AcquiredArtifact[];
  selectedRecordSet?: CandidateRecordSet;
  leads: GenericShadowLead[];
  diagnostics?: AcquisitionDiagnostics;
}): AvailableCountEstimate {
  const observedValidEvents = input.leads.length;
  const candidates = [
    ...collectApiTotals(input.artifacts),
    ...collectVisibleCounts(input.artifacts),
    ...collectPaginationEstimate({ artifacts: input.artifacts, observedValidEvents, diagnostics: input.diagnostics }),
  ];

  if (input.selectedRecordSet?.records.length) {
    candidates.push({
      estimatedAvailableRecords: Math.max(input.selectedRecordSet.records.length, observedValidEvents),
      method: "inferred",
      confidence: "inferred",
      evidence: [`selected record set contains ${input.selectedRecordSet.records.length} records`],
      contradictions: [],
      priority: 4,
    });
  } else if (observedValidEvents > 0) {
    candidates.push({
      estimatedAvailableRecords: observedValidEvents,
      method: "inferred",
      confidence: "inferred",
      evidence: [`fallback to ${observedValidEvents} observed valid events`],
      contradictions: [],
      priority: 4,
    });
  }

  const contradictions = contradictionMessages(candidates);
  const selected = candidates
    .filter((candidate) => candidate.estimatedAvailableRecords !== undefined)
    .sort((left, right) => left.priority - right.priority || (right.estimatedAvailableRecords ?? 0) - (left.estimatedAvailableRecords ?? 0))[0];

  if (!selected) {
    return {
      method: "unknown",
      confidence: "unknown",
      evidence: ["no authoritative, visible, pagination-derived, or inferred live total found"],
      contradictions,
    };
  }

  const estimatedAvailableRecords = Math.max(selected.estimatedAvailableRecords ?? 0, observedValidEvents);
  const evidence = [...selected.evidence];
  if ((selected.estimatedAvailableRecords ?? 0) < observedValidEvents) {
    evidence.push(`raised estimate floor to ${observedValidEvents} extracted valid events`);
  }

  return {
    estimatedAvailableRecords,
    method: selected.method,
    confidence: selected.confidence,
    evidence,
    contradictions,
  };
}
