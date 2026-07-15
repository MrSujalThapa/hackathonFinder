import type {
  CandidateArrayDiagnostic,
  ExtractionQuality,
  ShadowLead,
} from "@/experiments/scraper-v2/types";
import { DEVFOLIO_CONFIG } from "@/experiments/scraper-v2/devfolioConfig";

function ratio(count: number, total: number): number {
  if (total <= 0) return 0;
  return Number((count / total).toFixed(3));
}

function hasDate(lead: ShadowLead): boolean {
  return Boolean(lead.startDate || lead.endDate || lead.registrationDeadline);
}

function isObviousNonEvent(lead: ShadowLead): boolean {
  if (DEVFOLIO_CONFIG.nonEventTitlePattern.test(lead.title)) return true;
  if (!lead.canonicalUrl) return false;
  try {
    const url = new URL(lead.canonicalUrl);
    return DEVFOLIO_CONFIG.rejectedPaths.has(url.pathname.replace(/\/$/, ""));
  } catch {
    return true;
  }
}

function duplicateRate(leads: ShadowLead[]): number {
  if (leads.length === 0) return 0;
  const keys = leads.map((lead) => lead.sourceRecordId ?? lead.canonicalUrl ?? lead.title.toLowerCase());
  return Number(((keys.length - new Set(keys).size) / keys.length).toFixed(3));
}

export function evaluateExtractionQuality(input: {
  arrays: CandidateArrayDiagnostic[];
  selectedArrays: CandidateArrayDiagnostic[];
  leads: ShadowLead[];
  durationMs: number;
  acquisitionMode: "static" | "browser";
  requestsMade: number;
}): ExtractionQuality {
  const obviousNonEvents = input.leads.filter(isObviousNonEvent).length;
  const validIndividualEventCount = input.leads.length - obviousNonEvents;
  return {
    structuredRecordCount: input.selectedArrays.reduce(
      (total, array) => total + array.recordCount,
      0,
    ),
    selectedArrayCount: input.selectedArrays.length,
    normalizedLeadCount: input.leads.length,
    validIndividualEventCount,
    obviousNonEventCount: obviousNonEvents,
    titleCompleteness: ratio(input.leads.filter((lead) => lead.title).length, input.leads.length),
    urlCompleteness: ratio(input.leads.filter((lead) => lead.canonicalUrl).length, input.leads.length),
    dateCompleteness: ratio(input.leads.filter(hasDate).length, input.leads.length),
    locationCompleteness: ratio(input.leads.filter((lead) => lead.location).length, input.leads.length),
    duplicateRate: duplicateRate(input.leads),
    extractionDurationMs: Math.round(input.durationMs),
    acquisitionMode: input.acquisitionMode,
    requestsMade: input.requestsMade,
  };
}
