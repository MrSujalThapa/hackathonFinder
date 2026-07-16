import type {
  ExtractionQualityReport,
  GenericShadowLead,
  SourceExperiment,
} from "@/crawl/adapters/custom/generic/types";
import type { AvailableCountEstimate } from "@/crawl/adapters/custom/generic/coverageEstimate";
import { normalizeRatio, stableDedupeKey } from "@/crawl/adapters/custom/generic/valueUtils";

function duplicateRate(leads: GenericShadowLead[]): number {
  if (leads.length === 0) return 0;
  const keys = leads.map((lead) =>
    stableDedupeKey([lead.sourceRecordId, lead.canonicalUrl, lead.title, lead.startDate]),
  );
  return normalizeRatio((keys.length - new Set(keys).size) / keys.length);
}

function isObviousNonEvent(lead: GenericShadowLead): boolean {
  if (/^(open|past|upcoming|organize|menu|home|about|sponsor|faq)$/i.test(lead.title)) return true;
  if (lead.normalizedStatus === "past" || lead.normalizedStatus === "closed") return true;
  if (!lead.canonicalUrl) return false;
  try {
    const url = new URL(lead.canonicalUrl);
    return /\/(?:about|login|signin|signup|sponsors?|organizers?|contact|privacy|terms)\/?$/i.test(url.pathname);
  } catch {
    return true;
  }
}

function ratio(count: number, total: number): number {
  return normalizeRatio(total <= 0 ? 0 : count / total);
}

export function evaluateGenericExtractionQuality(input: {
  discoveredRecords: number;
  leads: GenericShadowLead[];
  experiment: SourceExperiment;
  blockedReason?: string;
  schemaRejected?: boolean;
  estimatedAvailableRecords?: number;
  availableEstimate?: AvailableCountEstimate;
  sourceExhausted?: boolean;
  capReached?: boolean;
}): ExtractionQualityReport {
  const obviousNonEvents = input.leads.filter(isObviousNonEvent).length;
  const validEventLeads = Math.max(0, input.leads.length - obviousNonEvents);
  const duplicates = duplicateRate(input.leads);
  const degradedReasons: string[] = [];
  if (input.blockedReason) degradedReasons.push(input.blockedReason);
  if (input.schemaRejected) degradedReasons.push("selected schema rejected");
  if (input.discoveredRecords > 0 && input.leads.length === 0) degradedReasons.push("records discovered but none normalized");
  if (input.leads.length > 0 && ratio(validEventLeads, input.leads.length) < 0.7) degradedReasons.push("low precision estimate");
  if (input.leads.length > 0 && ratio(input.leads.filter((lead) => lead.title).length, input.leads.length) < 0.8) degradedReasons.push("low title completeness");
  if (duplicates > 0.2) degradedReasons.push("high duplicate rate");
  const availableEstimate: AvailableCountEstimate = input.availableEstimate ?? {
    ...(input.estimatedAvailableRecords !== undefined ? { estimatedAvailableRecords: input.estimatedAvailableRecords } : {}),
    method: input.estimatedAvailableRecords !== undefined ? "inferred" : "unknown",
    confidence: input.estimatedAvailableRecords !== undefined ? "inferred" : "unknown",
    evidence: input.estimatedAvailableRecords !== undefined
      ? [`legacy inferred estimate ${input.estimatedAvailableRecords}`]
      : ["no live estimate supplied"],
    contradictions: [],
  };
  const estimatedAvailableRecords = availableEstimate.estimatedAvailableRecords;
  if (estimatedAvailableRecords && validEventLeads < estimatedAvailableRecords * 0.5) {
    degradedReasons.push("under-extracted against live source estimate");
  }
  if (availableEstimate.contradictions.length > 0) {
    degradedReasons.push(`available-count contradiction: ${availableEstimate.contradictions.join("; ")}`);
  }

  const estimatedPrecision = input.leads.length === 0 ? 0 : ratio(validEventLeads, input.leads.length);
  const estimatedRecall = estimatedAvailableRecords
    ? normalizeRatio(validEventLeads / estimatedAvailableRecords)
    : undefined;

  let classification: ExtractionQualityReport["classification"] = "usable_partial";
  if (/human|captcha|challenge|awswaf/i.test(input.blockedReason ?? "")) classification = "blocked_human_verification";
  else if (/auth|login|sign.?in/i.test(input.blockedReason ?? "")) classification = "blocked_authentication";
  else if (/404|not found|missing route|static response returned 404/i.test(input.blockedReason ?? "")) classification = "stale_or_missing_route";
  else if (input.blockedReason) classification = "acquisition_failed";
  else if (validEventLeads === 0 && input.discoveredRecords > 0) classification = "extraction_failed";
  else if (validEventLeads === 0) classification = "acquisition_failed";
  else if (estimatedPrecision < 0.9) classification = "degraded_low_precision";
  else if (
    degradedReasons.some((reason) => /under-extracted|records discovered but none/i.test(reason)) ||
    (estimatedAvailableRecords !== undefined &&
      validEventLeads >= 5 &&
      estimatedAvailableRecords >= validEventLeads * 2 &&
      (estimatedRecall ?? 0) < 0.5)
  ) {
    classification = "degraded_under_extraction";
  } else if (
    (input.sourceExhausted && (estimatedRecall === undefined || estimatedRecall >= 0.8)) ||
    (estimatedRecall !== undefined && estimatedRecall >= 0.9)
  ) {
    classification = "healthy_complete";
  } else if (input.capReached && estimatedAvailableRecords !== undefined) {
    classification = "healthy_bounded";
  } else if (estimatedRecall !== undefined && estimatedRecall < 0.8) {
    classification = "usable_partial";
  } else if (validEventLeads < 5) {
    classification = "usable_partial";
  }

  return {
    discoveredRecords: input.discoveredRecords,
    normalizedLeads: input.leads.length,
    validEventLeads,
    obviousNonEvents,
    titleCompleteness: ratio(input.leads.filter((lead) => lead.title).length, input.leads.length),
    urlCompleteness: ratio(input.leads.filter((lead) => lead.canonicalUrl).length, input.leads.length),
    dateCompleteness: ratio(
      input.leads.filter((lead) => lead.startDate || lead.endDate || lead.deadline).length,
      input.leads.length,
    ),
    duplicateRate: duplicates,
    estimatedPrecision,
    ...(estimatedAvailableRecords !== undefined ? { estimatedAvailableRecords } : {}),
    availableEstimateMethod: availableEstimate.method,
    availableEstimateConfidence: availableEstimate.confidence,
    availableEstimateEvidence: availableEstimate.evidence,
    availableEstimateContradictions: availableEstimate.contradictions,
    ...(estimatedRecall !== undefined ? { estimatedRecall } : {}),
    degradedReasons,
    classification,
  };
}
