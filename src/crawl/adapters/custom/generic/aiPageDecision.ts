import { z } from "zod";
import { createLlmProviderOptional } from "@/lib/llm/createProvider";
import { generateJson, jsonObjectResponseFormat } from "@/lib/llm/structured";
import type { LlmProvider } from "@/lib/llm/types";
import { buildDomRepresentations } from "@/crawl/adapters/custom/generic/domRepresentation";
import type {
  AcquiredArtifact,
  CandidateAction,
  CandidateRecordSet,
  DomNodeSummary,
  EventIntentValidation,
  InferredEventSchema,
  RepeatedUnitSet,
} from "@/crawl/adapters/custom/generic/types";
import { boundedJson, cleanText } from "@/crawl/adapters/custom/generic/valueUtils";

export const AiPageDecisionSchema = z
  .object({
    selectedGroupId: z.string().min(1).optional(),
    classification: z.enum(["event_records", "navigation", "editorial", "forms", "sponsors", "uncertain"]),
    fields: z
      .object({
        title: z.string().min(1).optional(),
        url: z.string().min(1).optional(),
        date: z.string().min(1).optional(),
        location: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        sourceId: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    selectedActionId: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type AiPageDecision = z.infer<typeof AiPageDecisionSchema>;

export type PageCandidateGroup = {
  groupId: string;
  kind: "structured" | "dom";
  recordCount: number;
  confidence: number;
  titleCoverage: number;
  urlCoverage: number;
  dateCoverage: number;
  locationCoverage: number;
  sampleRecords: Array<Record<string, unknown>>;
  validatorReasons: string[];
};

export type AiPageDecisionInput = {
  sourceUrl: string;
  candidateGroups: PageCandidateGroup[];
  actionCandidates: Array<Pick<CandidateAction, "elementId" | "role" | "accessibleName" | "href" | "context" | "proposedEffect" | "confidence">>;
};

export type AiPageDecisionResult = {
  invoked: boolean;
  accepted: boolean;
  provider?: string;
  model?: string;
  latencyMs?: number;
  tokenEstimate?: number;
  sanitizedInput?: AiPageDecisionInput;
  decision?: AiPageDecision;
  rejectedReasons: string[];
};

function unsafeText(value: string): boolean {
  return /\b(?:javascript:|<script|document\.|window\.|eval\(|fetch\(|XMLHttpRequest|powershell|cmd\.exe|curl\s+|sql\s+select|insert\s+into|delete\s+from)\b/i.test(value);
}

function redactSample(value: unknown): string {
  return boundedJson(value, 900)
    .replace(/"cookie"\s*:\s*"[^"]*"/gi, "\"cookie\":\"[redacted]\"")
    .replace(/"authorization"\s*:\s*"[^"]*"/gi, "\"authorization\":\"[redacted]\"")
    .replace(/"api[_-]?key"\s*:\s*"[^"]*"/gi, "\"apiKey\":\"[redacted]\"")
    .replace(/"token"\s*:\s*"[^"]{8,}"/gi, "\"token\":\"[redacted]\"");
}

function stringRecord(value: string): Record<string, unknown> {
  return { text: value.slice(0, 500) };
}

function flattenText(nodes: DomNodeSummary[]): string {
  return nodes
    .flatMap((node) => [node.headingText, node.textSample])
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function nodeMap(nodes: DomNodeSummary[]): Map<number, DomNodeSummary> {
  return new Map(nodes.map((node) => [node.nodeId, node]));
}

function descendants(unit: DomNodeSummary, map: Map<number, DomNodeSummary>): DomNodeSummary[] {
  const out = [unit];
  const queue = [...unit.childIds];
  while (queue.length > 0 && out.length < 80) {
    const id = queue.shift();
    if (!id) continue;
    const node = map.get(id);
    if (!node) continue;
    out.push(node);
    queue.push(...node.childIds);
  }
  return out;
}

function structuredGroup(input: {
  recordSet: CandidateRecordSet;
  schema?: InferredEventSchema;
  validation?: EventIntentValidation;
}): PageCandidateGroup {
  const schema = input.schema;
  return {
    groupId: input.recordSet.recordSetId,
    kind: "structured",
    recordCount: input.recordSet.records.length,
    confidence: input.validation?.eventIntentScore ?? input.recordSet.confidence,
    titleCoverage: input.recordSet.fieldCoverage.title ?? (schema?.title ? 1 : 0),
    urlCoverage: input.recordSet.fieldCoverage.url ?? (schema?.url ? 1 : 0),
    dateCoverage: Math.max(input.recordSet.fieldCoverage.startDate ?? 0, input.recordSet.fieldCoverage.deadline ?? 0),
    locationCoverage: input.recordSet.fieldCoverage.location ?? 0,
    sampleRecords: input.recordSet.records.slice(0, 10).map((record) => stringRecord(redactSample(record))),
    validatorReasons: [...(input.validation?.reasons ?? []), ...(schema?.rejectionReasons ?? [])].slice(0, 8),
  };
}

function domGroups(input: {
  artifacts: AcquiredArtifact[];
  repeatedUnitSets: RepeatedUnitSet[];
}): PageCandidateGroup[] {
  const representations = buildDomRepresentations(input.artifacts);
  const byArtifact = new Map(representations.map((representation) => [representation.artifactId, representation]));
  return input.repeatedUnitSets.slice(0, 8).map((unitSet) => {
    const representation = byArtifact.get(unitSet.artifactId);
    const map = representation ? nodeMap(representation.nodes) : new Map<number, DomNodeSummary>();
    const samples = unitSet.unitNodeIds
      .slice(0, 10)
      .map((id) => map.get(id))
      .filter((node): node is DomNodeSummary => Boolean(node))
      .map((node) => stringRecord(flattenText(descendants(node, map))));
    return {
      groupId: unitSet.unitSetId,
      kind: "dom",
      recordCount: unitSet.diagnostics.unitCount,
      confidence: unitSet.confidence,
      titleCoverage: unitSet.diagnostics.uniqueTitleRatio,
      urlCoverage: unitSet.diagnostics.uniqueUrlRatio,
      dateCoverage: unitSet.diagnostics.dateCoverage,
      locationCoverage: unitSet.diagnostics.locationCoverage,
      sampleRecords: samples,
      validatorReasons: unitSet.rejectionReasons.slice(0, 8),
    };
  });
}

export function buildAiPageDecisionInput(input: {
  sourceUrl: string;
  artifacts: AcquiredArtifact[];
  recordSets: CandidateRecordSet[];
  schemas: Map<string, InferredEventSchema>;
  validations: EventIntentValidation[];
  repeatedUnitSets: RepeatedUnitSet[];
  actionCandidates: CandidateAction[];
}): AiPageDecisionInput {
  const validationById = new Map(input.validations.map((validation) => [validation.recordSetId, validation]));
  const groups = [
    ...input.recordSets.slice(0, 5).map((recordSet) =>
      structuredGroup({
        recordSet,
        schema: input.schemas.get(recordSet.recordSetId),
        validation: validationById.get(recordSet.recordSetId),
      }),
    ),
    ...domGroups({ artifacts: input.artifacts, repeatedUnitSets: input.repeatedUnitSets }),
  ]
    .filter((group) => group.recordCount >= 2)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 5);

  return {
    sourceUrl: new URL(input.sourceUrl).origin,
    candidateGroups: groups.map((group) => ({
      ...group,
      sampleRecords: group.sampleRecords.slice(0, 10).map((record) => {
        const text = cleanText(record.text) ?? "";
        return { text: text.slice(0, 500) };
      }),
    })),
    actionCandidates: input.actionCandidates
      .filter((action) => !action.disabled && action.confidence >= 0.4)
      .slice(0, 10)
      .map((action) => ({
        elementId: action.elementId,
        ...(action.role ? { role: action.role } : {}),
        ...(action.accessibleName ? { accessibleName: action.accessibleName.slice(0, 120) } : {}),
        ...(action.href ? { href: action.href } : {}),
        context: action.context,
        proposedEffect: action.proposedEffect,
        confidence: action.confidence,
      })),
  };
}

export function shouldInvokeAiPageDecision(input: {
  deterministicValidEvents: number;
  candidateGroups: PageCandidateGroup[];
  alreadyAttempted?: boolean;
  blockedReason?: string;
}): boolean {
  if (input.blockedReason || input.alreadyAttempted) return false;
  if (input.deterministicValidEvents > 0) return false;
  return input.candidateGroups.some((group) => {
    if (group.recordCount < 2 || group.confidence < 0.45) return false;
    if (group.kind === "dom") return group.titleCoverage >= 0.7 || group.dateCoverage >= 0.4;
    return group.titleCoverage >= 0.5;
  });
}

export function validateAiPageDecision(value: unknown, input: AiPageDecisionInput): {
  ok: true;
  decision: AiPageDecision;
} | {
  ok: false;
  reasons: string[];
} {
  const parsed = AiPageDecisionSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, reasons: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  }
  const serialized = JSON.stringify(parsed.data);
  if (unsafeText(serialized)) return { ok: false, reasons: ["decision contains executable or unsafe instructions"] };
  if (parsed.data.confidence < 0.55) return { ok: false, reasons: ["decision confidence below acceptance floor"] };
  if (parsed.data.selectedGroupId && !input.candidateGroups.some((group) => group.groupId === parsed.data.selectedGroupId)) {
    return { ok: false, reasons: ["selected group is not one of the supplied candidates"] };
  }
  if (parsed.data.selectedActionId && !input.actionCandidates.some((action) => action.elementId === parsed.data.selectedActionId)) {
    return { ok: false, reasons: ["selected action is not one of the supplied candidates"] };
  }
  const fieldValues = Object.values(parsed.data.fields ?? {});
  if (fieldValues.some((field) => /https?:\/\/|\/api\/|graphql|endpoint|selector|querySelector/i.test(field))) {
    return { ok: false, reasons: ["decision appears to invent endpoints, selectors, or URLs"] };
  }
  return { ok: true, decision: parsed.data };
}

export async function requestAiPageDecision(input: {
  sanitizedInput: AiPageDecisionInput;
  provider?: LlmProvider | null;
  signal?: AbortSignal;
}): Promise<AiPageDecisionResult> {
  const provider = input.provider === undefined
    ? createLlmProviderOptional({ instrument: false })
    : input.provider;
  if (!provider) {
    return {
      invoked: false,
      accepted: false,
      sanitizedInput: input.sanitizedInput,
      rejectedReasons: ["LLM provider not configured"],
    };
  }

  const startedAt = Date.now();
  const { value, response } = await generateJson(
    provider,
    {
      messages: [
        {
          role: "system",
          content:
            "You select among supplied public event-directory candidate groups. Return only one JSON object with exactly these top-level keys when needed: selectedGroupId, classification, fields, selectedActionId, confidence. classification must be one of: event_records, navigation, editorial, forms, sponsors, uncertain. Do not use DOM, list, cards, or any other classification. Extra keys are rejected. Do not invent selectors, endpoints, URLs, records, code, or browser instructions. Example: {\"selectedGroupId\":\"dom:1\",\"classification\":\"event_records\",\"fields\":{\"title\":\"visible title text\",\"date\":\"visible date text\"},\"confidence\":0.82}",
        },
        {
          role: "user",
          content: JSON.stringify(input.sanitizedInput),
        },
      ],
      responseFormat: jsonObjectResponseFormat(),
      maxOutputTokens: 500,
      temperature: 0,
      timeoutMs: 8_000,
      signal: input.signal,
      metadata: { experiment: "scraper-v2-phase-5-4" },
    },
    (value) => value,
  );
  const validation = validateAiPageDecision(value, input.sanitizedInput);
  if (!validation.ok) {
    return {
      invoked: true,
      accepted: false,
      provider: response.provider,
      model: response.model,
      latencyMs: Date.now() - startedAt,
      tokenEstimate: response.usage?.totalTokens,
      sanitizedInput: input.sanitizedInput,
      rejectedReasons: validation.reasons,
    };
  }
  return {
    invoked: true,
    accepted: true,
    provider: response.provider,
    model: response.model,
    latencyMs: Date.now() - startedAt,
    tokenEstimate: response.usage?.totalTokens,
    sanitizedInput: input.sanitizedInput,
    decision: validation.decision,
    rejectedReasons: [],
  };
}
