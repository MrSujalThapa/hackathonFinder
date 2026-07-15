import { z } from "zod";
import type { RepeatedUnitSet } from "@/experiments/scraper-v2/generic/types";

export const VisualGroupingDecisionSchema = z
  .object({
    selectedGroupId: z.string().min(1).optional(),
    cardNodeIds: z.array(z.number().int().positive()).max(80).optional(),
    fieldRegions: z
      .object({
        titleNodeIds: z.array(z.number().int().positive()).max(80).optional(),
        urlNodeIds: z.array(z.number().int().positive()).max(80).optional(),
        dateNodeIds: z.array(z.number().int().positive()).max(80).optional(),
        locationNodeIds: z.array(z.number().int().positive()).max(80).optional(),
      })
      .strict()
      .optional(),
    likelyPaginationControlId: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type VisualGroupingDecision = z.infer<typeof VisualGroupingDecisionSchema>;

export function shouldInvokeVisionGrouping(input: {
  visibleEventLikeCards: boolean;
  deterministicLeads: number;
  aiAccepted: boolean;
  domUnitSets: number;
}): boolean {
  return input.visibleEventLikeCards && input.deterministicLeads === 0 && !input.aiAccepted && input.domUnitSets > 0;
}

export function validateVisualGroupingDecision(input: {
  value: unknown;
  unitSets: RepeatedUnitSet[];
}): {
  ok: true;
  decision: VisualGroupingDecision;
  mappedUnitSet: RepeatedUnitSet;
} | {
  ok: false;
  reasons: string[];
} {
  const parsed = VisualGroupingDecisionSchema.safeParse(input.value);
  if (!parsed.success) {
    return { ok: false, reasons: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  }
  if (parsed.data.confidence < 0.6) return { ok: false, reasons: ["visual proposal confidence below floor"] };
  const mapped = parsed.data.selectedGroupId
    ? input.unitSets.find((unitSet) => unitSet.unitSetId === parsed.data.selectedGroupId)
    : input.unitSets.find((unitSet) => {
        const proposed = new Set(parsed.data.cardNodeIds ?? []);
        if (proposed.size === 0) return false;
        const actual = new Set(unitSet.unitNodeIds);
        return [...proposed].filter((id) => actual.has(id)).length / Math.max(1, proposed.size) >= 0.9;
      });
  if (!mapped) return { ok: false, reasons: ["visual proposal did not map back to supplied DOM nodes"] };
  return { ok: true, decision: parsed.data, mappedUnitSet: mapped };
}
