import type { OpportunityType } from "@/core/applications/types";

/** Cheap, explainable classification; LLM enrichment may refine it but is never required. */
export function classifyOpportunityType(...values: Array<string | undefined>): OpportunityType {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  if (/hackathon|hack day|buildathon|codeathon|datathon/.test(text)) return "hackathon";
  if (/fellowship/.test(text)) return "fellowship";
  if (/accelerator|incubator/.test(text)) return "accelerator";
  if (/startup program|founder program/.test(text)) return "startup_program";
  if (/pitch competition|pitch contest/.test(text)) return "pitch_competition";
  if (/conference|summit/.test(text)) return "conference";
  if (/competition|challenge|contest/.test(text)) return "competition";
  if (/event|meetup|workshop|webinar|talk|panel/.test(text)) return "tech_event";
  // Preserve the established discovery contract for ambiguous legacy collector
  // records; explicit non-hackathon wording is still classified above.
  return "hackathon";
}
