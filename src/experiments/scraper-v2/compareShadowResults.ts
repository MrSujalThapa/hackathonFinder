import type { RawLead } from "@/core/discovery/types";
import type { DevfolioShadowResult, ShadowLead } from "@/experiments/scraper-v2/types";
import { DEVFOLIO_CONFIG } from "@/experiments/scraper-v2/devfolioConfig";

export type V1V2Comparison = {
  v1Units: number;
  v1NormalizedLeads: number;
  v1ObviousNonEvents: number;
  v2StructuredRecords: number;
  v2NormalizedLeads: number;
  v2ValidEvents: number;
  v2ObviousNonEvents: number;
  overlappingTitles: number;
  v2OnlyTitles: string[];
};

function normalizedTitle(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isObviousV1NonEvent(lead: RawLead): boolean {
  return DEVFOLIO_CONFIG.nonEventTitlePattern.test(lead.title ?? "");
}

function isObviousV2NonEvent(lead: ShadowLead): boolean {
  return DEVFOLIO_CONFIG.nonEventTitlePattern.test(lead.title);
}

export function compareShadowResults(v1: RawLead[], v2: DevfolioShadowResult): V1V2Comparison {
  const v1Titles = new Set(v1.map((lead) => normalizedTitle(lead.title)).filter(Boolean));
  const v2Titles = v2.leads.map((lead) => normalizedTitle(lead.title)).filter(Boolean);
  return {
    v1Units: v1.length,
    v1NormalizedLeads: v1.length,
    v1ObviousNonEvents: v1.filter(isObviousV1NonEvent).length,
    v2StructuredRecords: v2.quality.structuredRecordCount,
    v2NormalizedLeads: v2.leads.length,
    v2ValidEvents: v2.quality.validIndividualEventCount,
    v2ObviousNonEvents: v2.leads.filter(isObviousV2NonEvent).length,
    overlappingTitles: v2Titles.filter((title) => v1Titles.has(title)).length,
    v2OnlyTitles: v2.leads
      .filter((lead) => !v1Titles.has(normalizedTitle(lead.title)))
      .map((lead) => lead.title)
      .slice(0, 20),
  };
}
