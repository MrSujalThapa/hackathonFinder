import type {
  CandidateRecordSet,
  PaginationInference,
} from "@/experiments/scraper-v2/generic/types";
import { boundedJson, isPlainRecord, normalizeRatio } from "@/experiments/scraper-v2/generic/valueUtils";

function inspectForPagination(value: unknown, evidence: string[], depth = 0): void {
  if (depth > 5 || evidence.length >= 12) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 12)) inspectForPagination(item, evidence, depth + 1);
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const keyText = key.toLowerCase();
    const valueText = boundedJson(child, 240).toLowerCase();
    if (/\b(next|nextpage|next_page|hasnext|has_more)\b/.test(keyText)) evidence.push(`next signal at ${key}`);
    if (/\b(cursor|endcursor|nextcursor|after)\b/.test(keyText)) evidence.push(`cursor signal at ${key}`);
    if (/\b(page|pageinfo|totalpages|currentpage)\b/.test(keyText)) evidence.push(`page-number signal at ${key}`);
    if (/\b(offset|limit|skip)\b/.test(keyText)) evidence.push(`offset signal at ${key}`);
    if (/\b(next|cursor|page|offset|has_more)\b/.test(valueText)) evidence.push(`pagination-like value near ${key}`);
    inspectForPagination(child, evidence, depth + 1);
  }
}

export function inferGenericPagination(recordSet: CandidateRecordSet | undefined): PaginationInference {
  if (!recordSet) {
    return {
      method: "none",
      confidence: 0,
      evidence: [],
      pageCount: 1,
      stopReason: "not_attempted",
    };
  }
  const evidence: string[] = [];
  inspectForPagination(recordSet.records.slice(0, 5), evidence);
  const joined = evidence.join(" ");
  let method: PaginationInference["method"] = "none";
  if (/cursor/i.test(joined)) method = "cursor";
  else if (/next/i.test(joined)) method = "next_link";
  else if (/offset/i.test(joined)) method = "offset";
  else if (/page-number/i.test(joined)) method = "page_number";

  return {
    method,
    confidence: method === "none" ? 0 : normalizeRatio(0.45 + Math.min(evidence.length, 5) * 0.1),
    evidence: evidence.slice(0, 8),
    pageCount: 1,
    stopReason: method === "none" ? "no_signal" : "not_attempted",
  };
}
