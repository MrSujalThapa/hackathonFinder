import { performance } from "node:perf_hooks";
import { z } from "zod";
import { createLlmProviderOptional } from "@/lib/llm/createProvider";
import type { LlmProvider } from "@/lib/llm/types";
import type {
  AcquiredArtifact,
  CandidateAction,
  DomExtractionResult,
  RepeatedUnitSet,
} from "@/experiments/scraper-v2/generic/types";

const MAX_IMAGE_BYTES = 900_000;

export const VisionPageDecisionSchema = z
  .object({
    selectedGroupIds: z.array(z.string().min(1)).max(5).optional(),
    fieldRegions: z
      .object({
        title: z.string().min(1).optional(),
        date: z.string().min(1).optional(),
        location: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    selectedActionId: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type VisionPageDecision = z.infer<typeof VisionPageDecisionSchema>;

export type VisionCandidateGroup = {
  groupId: string;
  unitNodeIds: number[];
  confidence: number;
  dateCoverage: number;
  sampleTexts: string[];
  boundingBoxes: Array<{ nodeId: number; x: number; y: number; width: number; height: number }>;
};

export type VisionPageDecisionInput = {
  sourceOrigin: string;
  screenshotBase64: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  candidateGroups: VisionCandidateGroup[];
  actionCandidates: Array<Pick<CandidateAction, "elementId" | "accessibleName" | "proposedEffect" | "confidence">>;
};

export type VisionPageDecisionResult = {
  invoked: boolean;
  accepted: boolean;
  provider?: string;
  model?: string;
  latencyMs?: number;
  decision?: VisionPageDecision;
  mappedUnitSets: RepeatedUnitSet[];
  sanitizedInput?: Omit<VisionPageDecisionInput, "screenshotBase64"> & { screenshotBytes: number };
  rejectedReasons: string[];
};

function ms(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function htmlPayload(artifact: AcquiredArtifact): Record<string, unknown> | undefined {
  if (artifact.kind !== "html" && artifact.kind !== "dom_snapshot") return undefined;
  if (!artifact.payload || typeof artifact.payload !== "object" || Array.isArray(artifact.payload)) return undefined;
  return artifact.payload as Record<string, unknown>;
}

function visualNodesFor(artifact: AcquiredArtifact): Map<number, {
  text: string;
  boundingBox: { x: number; y: number; width: number; height: number };
}> {
  const payload = htmlPayload(artifact);
  const raw = payload?.visualNodes;
  if (!Array.isArray(raw)) return new Map();
  const out = new Map<number, { text: string; boundingBox: { x: number; y: number; width: number; height: number } }>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const nodeId = record.nodeId;
    const text = record.text;
    const box = record.boundingBox;
    if (typeof nodeId !== "number" || typeof text !== "string" || !box || typeof box !== "object" || Array.isArray(box)) continue;
    const b = box as Record<string, unknown>;
    if (typeof b.x !== "number" || typeof b.y !== "number" || typeof b.width !== "number" || typeof b.height !== "number") continue;
    out.set(nodeId, { text, boundingBox: { x: b.x, y: b.y, width: b.width, height: b.height } });
  }
  return out;
}

function screenshotFromArtifacts(artifacts: AcquiredArtifact[]): {
  base64: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  artifactId: string;
} | undefined {
  for (const artifact of artifacts) {
    const payload = htmlPayload(artifact);
    const screenshot = payload?.screenshotBase64;
    const mediaType = payload?.screenshotMediaType;
    if (typeof screenshot !== "string" || screenshot.length === 0) continue;
    const bytes = Math.ceil((screenshot.length * 3) / 4);
    if (bytes > MAX_IMAGE_BYTES) continue;
    if (mediaType !== "image/png" && mediaType !== "image/jpeg" && mediaType !== "image/webp") continue;
    return { base64: screenshot, mediaType, artifactId: artifact.artifactId };
  }
  return undefined;
}

export function buildVisionPageDecisionInput(input: {
  sourceUrl: string;
  artifacts: AcquiredArtifact[];
  dom: DomExtractionResult;
  actionCandidates: CandidateAction[];
}): VisionPageDecisionInput | undefined {
  const screenshot = screenshotFromArtifacts(input.artifacts);
  if (!screenshot) return undefined;
  const artifact = input.artifacts.find((item) => item.artifactId === screenshot.artifactId);
  if (!artifact) return undefined;
  const nodes = visualNodesFor(artifact);
  if (nodes.size === 0) return undefined;
  const candidateGroups = input.dom.repeatedUnitSets
    .filter((unitSet) => unitSet.artifactId === artifact.artifactId)
    .map((unitSet): VisionCandidateGroup => {
      let boxes = unitSet.unitNodeIds
        .map((nodeId) => {
          const node = nodes.get(nodeId);
          return node ? { nodeId, ...node.boundingBox } : undefined;
        })
        .filter((box): box is VisionCandidateGroup["boundingBoxes"][number] => Boolean(box))
        .slice(0, 20);
      let sampleTexts = unitSet.unitNodeIds
        .map((nodeId) => nodes.get(nodeId)?.text)
        .filter((value): value is string => Boolean(value))
        .slice(0, 10);
      if (boxes.length === 0 || sampleTexts.length === 0) {
        const eventLikeNodes = [...nodes.entries()]
          .filter(([, node]) => /\b(hackathons?|challenges?|events?|summit|conference|competition|register|apply|prize)\b/i.test(node.text))
          .slice(0, 20);
        boxes = eventLikeNodes.map(([nodeId, node]) => ({ nodeId, ...node.boundingBox })).slice(0, 20);
        sampleTexts = eventLikeNodes.map(([, node]) => node.text).slice(0, 10);
      }
      return {
        groupId: unitSet.unitSetId,
        unitNodeIds: unitSet.unitNodeIds.slice(0, 30),
        confidence: unitSet.confidence,
        dateCoverage: unitSet.diagnostics.dateCoverage,
        sampleTexts,
        boundingBoxes: boxes,
      };
    })
    .filter((group) => group.boundingBoxes.length > 0 && group.sampleTexts.length > 0)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 5);
  if (candidateGroups.length === 0) return undefined;
  return {
    sourceOrigin: new URL(input.sourceUrl).origin,
    screenshotBase64: screenshot.base64,
    mediaType: screenshot.mediaType,
    candidateGroups,
    actionCandidates: input.actionCandidates
      .filter((action) => action.confidence >= 0.55)
      .slice(0, 10)
      .map((action) => ({
        elementId: action.elementId,
        accessibleName: action.accessibleName,
        proposedEffect: action.proposedEffect,
        confidence: action.confidence,
      })),
  };
}

export function shouldInvokeVisionPageDecision(input: {
  deterministicValidEvents: number;
  textAiAccepted: boolean;
  visionInput?: VisionPageDecisionInput;
}): boolean {
  if (input.deterministicValidEvents > 0 || input.textAiAccepted || !input.visionInput) return false;
  return input.visionInput.candidateGroups.some((group) =>
    group.sampleTexts.some((text) => /\b(hackathons?|challenges?|events?|summit|conference|competition|register|apply|prize)\b/i.test(text)),
  );
}

export function validateVisionPageDecision(input: {
  value: unknown;
  sanitizedInput: VisionPageDecisionInput;
  unitSets: RepeatedUnitSet[];
}): { ok: true; decision: VisionPageDecision; mappedUnitSets: RepeatedUnitSet[] } | { ok: false; reasons: string[] } {
  const parsed = VisionPageDecisionSchema.safeParse(input.value);
  if (!parsed.success) return { ok: false, reasons: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  if (parsed.data.confidence < 0.65) return { ok: false, reasons: ["vision proposal confidence below floor"] };
  const allowedGroups = new Set(input.sanitizedInput.candidateGroups.map((group) => group.groupId));
  const allowedActions = new Set(input.sanitizedInput.actionCandidates.map((action) => action.elementId));
  const selectedGroupIds = parsed.data.selectedGroupIds ?? [];
  if (selectedGroupIds.length === 0 && !parsed.data.selectedActionId) {
    return { ok: false, reasons: ["vision proposal selected no group or action"] };
  }
  const unknownGroups = selectedGroupIds.filter((groupId) => !allowedGroups.has(groupId));
  if (unknownGroups.length > 0) return { ok: false, reasons: [`vision proposal invented group ids: ${unknownGroups.join(", ")}`] };
  if (parsed.data.selectedActionId && !allowedActions.has(parsed.data.selectedActionId)) {
    return { ok: false, reasons: ["vision proposal invented action id"] };
  }
  const serialized = JSON.stringify(parsed.data);
  if (/querySelector|document\.|https?:\/\/|\/api\/|xpath|css selector/i.test(serialized)) {
    return { ok: false, reasons: ["vision proposal contained executable text, URL, endpoint, or selector"] };
  }
  const mapped = selectedGroupIds
    .map((groupId) => input.unitSets.find((unitSet) => unitSet.unitSetId === groupId))
    .filter((unitSet): unitSet is RepeatedUnitSet => Boolean(unitSet));
  return { ok: true, decision: parsed.data, mappedUnitSets: mapped };
}

export async function requestVisionPageDecision(input: {
  sanitizedInput: VisionPageDecisionInput;
  unitSets: RepeatedUnitSet[];
  provider?: LlmProvider | null;
  signal?: AbortSignal;
}): Promise<VisionPageDecisionResult> {
  const provider = input.provider === undefined ? createLlmProviderOptional({ instrument: false }) : input.provider;
  const screenshotBytes = Math.ceil((input.sanitizedInput.screenshotBase64.length * 3) / 4);
  const redactedInput = {
    ...input.sanitizedInput,
    screenshotBase64: undefined,
    screenshotBytes,
  };
  if (!provider) {
    return {
      invoked: false,
      accepted: false,
      mappedUnitSets: [],
      sanitizedInput: redactedInput,
      rejectedReasons: ["image-capable provider is not configured"],
    };
  }
  const startedAt = performance.now();
  const userText = JSON.stringify({
    sourceOrigin: input.sanitizedInput.sourceOrigin,
    candidateGroups: input.sanitizedInput.candidateGroups,
    actionCandidates: input.sanitizedInput.actionCandidates,
  });
  const response = await provider.generate({
    messages: [
      {
        role: "system",
        content:
          "You are a bounded visual grouping judge. Return strict JSON only. Select only supplied group ids or action ids. Do not invent events, URLs, selectors, endpoints, or DOM nodes.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          {
            type: "image",
            imageBase64: input.sanitizedInput.screenshotBase64,
            mediaType: input.sanitizedInput.mediaType,
            detail: "low",
          },
        ],
      },
    ],
    responseFormat: { type: "json_object" },
    maxOutputTokens: 500,
    temperature: 0,
    timeoutMs: 8_000,
    signal: input.signal,
    metadata: { experiment: "scraper-v2-phase-5-5-vision" },
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch (error) {
    return {
      invoked: true,
      accepted: false,
      provider: response.provider,
      model: response.model,
      latencyMs: ms(startedAt),
      mappedUnitSets: [],
      sanitizedInput: redactedInput,
      rejectedReasons: [error instanceof Error ? error.message : "vision response was not valid JSON"],
    };
  }
  const validation = validateVisionPageDecision({
    value: parsed,
    sanitizedInput: input.sanitizedInput,
    unitSets: input.unitSets,
  });
  if (!validation.ok) {
    return {
      invoked: true,
      accepted: false,
      provider: response.provider,
      model: response.model,
      latencyMs: ms(startedAt),
      mappedUnitSets: [],
      sanitizedInput: redactedInput,
      rejectedReasons: validation.reasons,
    };
  }
  return {
    invoked: true,
    accepted: true,
    provider: response.provider,
    model: response.model,
    latencyMs: ms(startedAt),
    decision: validation.decision,
    mappedUnitSets: validation.mappedUnitSets,
    sanitizedInput: redactedInput,
    rejectedReasons: [],
  };
}
