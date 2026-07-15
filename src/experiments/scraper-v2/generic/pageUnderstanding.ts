import * as cheerio from "cheerio";
import { enumerateCandidateActionsFromHtml } from "@/experiments/scraper-v2/generic/browserActions";
import { buildDomRepresentations } from "@/experiments/scraper-v2/generic/domRepresentation";
import { detectRepeatedDomUnitSets } from "@/experiments/scraper-v2/generic/domRepeatedUnits";
import { discoverGenericRecordSets } from "@/experiments/scraper-v2/generic/recordDiscovery";
import type {
  AcquiredArtifact,
  CandidateAction,
  CandidateRecordSet,
  RepeatedUnitSet,
} from "@/experiments/scraper-v2/generic/types";

export type PageUnderstandingObservation = {
  structuredRecords: number;
  domUnits: number;
  accessibilityNodes: number;
  iframeDocuments: number;
  shadowRoots: number;
  virtualizedGrowthSignals: number;
  modalSignals: number;
};

export type PageUnderstandingResult = {
  recordSets: CandidateRecordSet[];
  repeatedUnitSets: RepeatedUnitSet[];
  actionCandidates: CandidateAction[];
  observations: PageUnderstandingObservation;
};

function htmlFromArtifact(artifact: AcquiredArtifact): string | undefined {
  if (artifact.kind !== "html" && artifact.kind !== "dom_snapshot") return undefined;
  const payload = artifact.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const html = (payload as Record<string, unknown>).html;
  return typeof html === "string" ? html : undefined;
}

function countAccessibilityNodes($: cheerio.CheerioAPI): number {
  return $("[role],button,a[href],input,select,textarea,[aria-label],[aria-labelledby],[aria-describedby]")
    .toArray()
    .length;
}

function countVirtualizationSignals($: cheerio.CheerioAPI): number {
  return $("[aria-rowcount],[aria-setsize],[data-virtualized],[data-virtual-list],[style*='translateY'],[style*='transform']")
    .toArray()
    .length;
}

function countModalSignals($: cheerio.CheerioAPI): number {
  return $("[role='dialog'],[aria-modal='true'],dialog,[class*='modal'],[class*='drawer']")
    .toArray()
    .length;
}

export function understandPageArtifacts(artifacts: AcquiredArtifact[]): PageUnderstandingResult {
  const discovery = discoverGenericRecordSets(artifacts);
  const representations = buildDomRepresentations(artifacts);
  const repeatedUnitSets = detectRepeatedDomUnitSets(representations);
  const actionCandidates: CandidateAction[] = [];
  let accessibilityNodes = 0;
  let iframeDocuments = 0;
  let shadowRoots = 0;
  let virtualizedGrowthSignals = 0;
  let modalSignals = 0;

  for (const artifact of artifacts) {
    const html = htmlFromArtifact(artifact);
    if (!html) continue;
    const $ = cheerio.load(html);
    accessibilityNodes += countAccessibilityNodes($);
    iframeDocuments += $("iframe[src],iframe[srcdoc]").length;
    shadowRoots += $("template[shadowrootmode],template[shadowroot]").length;
    virtualizedGrowthSignals += countVirtualizationSignals($);
    modalSignals += countModalSignals($);
    actionCandidates.push(...enumerateCandidateActionsFromHtml(html, artifact.sourceUrl));
  }

  return {
    recordSets: discovery.recordSets,
    repeatedUnitSets,
    actionCandidates: actionCandidates
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 30),
    observations: {
      structuredRecords: discovery.recordsInspected,
      domUnits: repeatedUnitSets.length,
      accessibilityNodes,
      iframeDocuments,
      shadowRoots,
      virtualizedGrowthSignals,
      modalSignals,
    },
  };
}

export function shouldInvokeAiOrVision(input: {
  understanding: PageUnderstandingResult;
  deterministicHealthy: boolean;
  visibleCardText?: string;
}): {
  ai: boolean;
  vision: boolean;
  reasons: string[];
} {
  if (input.deterministicHealthy) return { ai: false, vision: false, reasons: [] };
  const reasons: string[] = [];
  if (input.understanding.recordSets.length === 0 && input.understanding.repeatedUnitSets.length === 0) {
    reasons.push("no deterministic candidate event group");
  }
  if (input.understanding.recordSets.length > 1 || input.understanding.repeatedUnitSets.length > 1) {
    reasons.push("multiple plausible groups need ranking");
  }
  if (input.understanding.actionCandidates.filter((action) => action.confidence >= 0.55).length > 1) {
    reasons.push("multiple safe actions need ranking");
  }
  const visibleLooksEventLike = /\b(hackathon|event|challenge|deadline|register|apply|prize)\b/i.test(input.visibleCardText ?? "");
  const vision = visibleLooksEventLike && input.understanding.repeatedUnitSets.length === 0;
  if (vision) reasons.push("visible event-like cards but DOM grouping failed");
  return {
    ai: reasons.length > 0,
    vision,
    reasons,
  };
}
