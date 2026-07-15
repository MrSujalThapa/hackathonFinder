import { z } from "zod";
import type {
  CandidateRecordSet,
  EventIntentValidation,
  InferredEventSchema,
} from "@/experiments/scraper-v2/generic/types";
import { boundedJson } from "@/experiments/scraper-v2/generic/valueUtils";

const DeclarativeFieldMappingSchema = z
  .object({
    title: z.string().min(1),
    url: z.string().min(1).optional(),
    startDate: z.string().min(1).optional(),
    endDate: z.string().min(1).optional(),
    deadline: z.string().min(1).optional(),
    location: z.string().min(1).optional(),
    mode: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    sourceRecordId: z.string().min(1).optional(),
  })
  .strict();

const PaginationHintSchema = z
  .object({
    proposedEffect: z.enum(["next_page", "load_more", "infinite_scroll", "change_sort", "change_filter", "open_detail", "unknown"]),
    selectorHint: z.string().max(120).optional(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const AiDecisionProposalSchema = z
  .object({
    classification: z.enum(["healthy", "usable", "ambiguous", "rejected"]),
    selectedRecordSetId: z.string().min(1).optional(),
    fieldMapping: DeclarativeFieldMappingSchema.optional(),
    paginationHint: PaginationHintSchema.optional(),
    confidence: z.number().min(0).max(1),
    reasoningSummary: z.string().max(500),
  })
  .strict();

export type AiDecisionProposal = z.infer<typeof AiDecisionProposalSchema>;

export type AiInvocationDecision = {
  shouldInvoke: boolean;
  reason:
    | "ambiguous_deterministic_result"
    | "deterministic_result_healthy"
    | "site_blocked"
    | "no_plausible_record_sets"
    | "already_attempted_page_shape";
};

function unsafeText(value: string): boolean {
  return /\b(?:javascript:|<script|document\.|window\.|eval\(|fetch\(|XMLHttpRequest|powershell|cmd\.exe|sql\s+select|insert\s+into|delete\s+from)\b/i.test(value);
}

export function decideAiInvocation(input: {
  validations: EventIntentValidation[];
  blockedReason?: string;
  attemptedPageShape: boolean;
}): AiInvocationDecision {
  if (input.blockedReason) return { shouldInvoke: false, reason: "site_blocked" };
  if (input.attemptedPageShape) return { shouldInvoke: false, reason: "already_attempted_page_shape" };
  if (input.validations.length === 0) return { shouldInvoke: false, reason: "no_plausible_record_sets" };
  if (input.validations.some((validation) => validation.classification === "healthy" || validation.classification === "usable")) {
    return { shouldInvoke: false, reason: "deterministic_result_healthy" };
  }
  if (input.validations.some((validation) => validation.classification === "ambiguous")) {
    return { shouldInvoke: true, reason: "ambiguous_deterministic_result" };
  }
  return { shouldInvoke: false, reason: "no_plausible_record_sets" };
}

export function buildSanitizedAiDecisionInput(input: {
  recordSets: CandidateRecordSet[];
  schemas: Array<InferredEventSchema | undefined>;
  validations: EventIntentValidation[];
}): {
  recordSets: Array<{
    recordSetId: string;
    artifactKind: string;
    path: string;
    sampleRecords: string[];
    validatorReasons: string[];
  }>;
} {
  const validationById = new Map(input.validations.map((validation) => [validation.recordSetId, validation]));
  return {
    recordSets: input.recordSets.slice(0, 5).map((recordSet, index) => ({
      recordSetId: recordSet.recordSetId,
      artifactKind: recordSet.artifactKind,
      path: recordSet.path,
      sampleRecords: recordSet.records.slice(0, 10).map((record) =>
        boundedJson(record, 900)
          .replace(/"cookie"\s*:\s*"[^"]*"/gi, "\"cookie\":\"[redacted]\"")
          .replace(/"authorization"\s*:\s*"[^"]*"/gi, "\"authorization\":\"[redacted]\"")
          .replace(/"api[_-]?key"\s*:\s*"[^"]*"/gi, "\"apiKey\":\"[redacted]\""),
      ),
      validatorReasons: [
        ...(validationById.get(recordSet.recordSetId)?.reasons ?? []),
        ...(input.schemas[index]?.rejectionReasons ?? []),
      ].slice(0, 8),
    })),
  };
}

export function validateAiDecisionProposal(value: unknown): {
  ok: true;
  proposal: AiDecisionProposal;
} | {
  ok: false;
  reasons: string[];
} {
  const parsed = AiDecisionProposalSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, reasons: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  }
  const serialized = JSON.stringify(parsed.data);
  if (unsafeText(serialized)) {
    return { ok: false, reasons: ["proposal contains executable or unsafe instructions"] };
  }
  if (parsed.data.confidence < 0.45) {
    return { ok: false, reasons: ["proposal confidence below acceptance floor"] };
  }
  return { ok: true, proposal: parsed.data };
}
