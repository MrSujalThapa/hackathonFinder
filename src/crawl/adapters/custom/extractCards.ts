import {
  buildAiPageDecisionInput,
  requestAiPageDecision,
  shouldInvokeAiPageDecision,
} from "@/crawl/adapters/custom/generic/aiPageDecision";
import { enumerateCandidateActionsFromHtml } from "@/crawl/adapters/custom/generic/browserActions";
import { runGenericDomExtraction } from "@/crawl/adapters/custom/generic/domExtraction";
import { validateEventIntent } from "@/crawl/adapters/custom/generic/eventIntentValidation";
import { inferGenericEventSchema } from "@/crawl/adapters/custom/generic/fieldInference";
import { normalizeGenericRecords } from "@/crawl/adapters/custom/generic/normalization";
import { evaluateGenericExtractionQuality } from "@/crawl/adapters/custom/generic/quality";
import { discoverGenericRecordSets } from "@/crawl/adapters/custom/generic/recordDiscovery";
import type {
  AcquiredArtifact,
  CandidateRecordSet,
  GenericShadowLead,
  SourceExperiment,
} from "@/crawl/adapters/custom/generic/types";
import { hasLlmConfig } from "@/config/env";
import type { ListingCard } from "@/crawl/types";
import { stableDedupeKey } from "@/crawl/adapters/custom/generic/valueUtils";

export type CardExtractionDiagnostics = {
  strategy: "structured" | "dom" | "none";
  deterministicOk: boolean;
  aiSelectionUsed: boolean;
  aiUnavailable: boolean;
  aiInvoked: boolean;
  selectedUnitSetId?: string;
  discoveredRecords: number;
  normalizedLeads: number;
  validEventLeads: number;
  classification: string;
  unitTag?: string;
  unitCount?: number;
  sampleTitles: string[];
};

export type CardExtractionResult = {
  leads: GenericShadowLead[];
  cards: ListingCard[];
  diagnostics: CardExtractionDiagnostics;
};

function htmlFromArtifact(artifact: AcquiredArtifact): string | undefined {
  if (artifact.kind !== "html" && artifact.kind !== "dom_snapshot") return undefined;
  const payload = artifact.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const html = (payload as Record<string, unknown>).html;
  return typeof html === "string" ? html : undefined;
}

function mergeCompatibleRecordSets(
  recordSets: CandidateRecordSet[],
): CandidateRecordSet[] {
  const merged = new Map<string, CandidateRecordSet>();
  for (const recordSet of recordSets) {
    const key = recordSet.path || `${recordSet.artifactKind}:<root>`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...recordSet, records: [...recordSet.records] });
      continue;
    }
    merged.set(key, {
      ...existing,
      recordSetId: `${existing.recordSetId}+${recordSet.recordSetId}`,
      records: [...existing.records, ...recordSet.records],
      inspectedRecords: existing.inspectedRecords + recordSet.inspectedRecords,
      structuralScore: Math.max(existing.structuralScore, recordSet.structuralScore),
      eventScore: Math.max(existing.eventScore, recordSet.eventScore),
      confidence: Math.max(existing.confidence, recordSet.confidence),
      duplicateRate: Math.max(existing.duplicateRate, recordSet.duplicateRate),
      rejectionReasons: [...new Set([...existing.rejectionReasons, ...recordSet.rejectionReasons])],
    });
  }
  return [...merged.values()].sort((left, right) => right.confidence - left.confidence);
}

function selectRecordSet(
  recordSets: CandidateRecordSet[],
  viableLeadCounts: Map<string, number>,
): CandidateRecordSet | undefined {
  return recordSets
    .filter((recordSet) => {
      if (
        recordSet.rejectionReasons.some((reason) =>
          /sponsor-only|filter\/facet-like|form\/questionnaire-like/i.test(reason),
        )
      ) {
        return false;
      }
      if ((viableLeadCounts.get(recordSet.recordSetId) ?? 0) <= 0) return false;
      return (
        recordSet.confidence >= 0.5 &&
        recordSet.eventScore >= 0.35 &&
        recordSet.records.length >= 2 &&
        recordSet.duplicateRate <= 0.45
      );
    })
    .sort((left, right) => {
      const leftViable = viableLeadCounts.get(left.recordSetId) ?? 0;
      const rightViable = viableLeadCounts.get(right.recordSetId) ?? 0;
      return rightViable - leftViable || right.confidence - left.confidence;
    })[0];
}

function leadToCard(lead: GenericShadowLead): ListingCard {
  const identity = stableDedupeKey([
    lead.sourceRecordId,
    lead.canonicalUrl,
    lead.title,
    lead.startDate,
  ]);
  const modeHint =
    lead.mode === "online" || lead.mode === "remote"
      ? "remote"
      : lead.mode === "hybrid"
        ? "hybrid"
        : lead.mode === "in_person" || lead.mode === "offline"
          ? "in_person"
          : "unknown";
  return {
    identity,
    title: lead.title,
    ...(lead.canonicalUrl ? { url: lead.canonicalUrl } : {}),
    ...(lead.startDate ? { startDate: lead.startDate } : {}),
    ...(lead.endDate ? { endDate: lead.endDate } : {}),
    modeHint,
    evidence: {
      ...(lead.deadline ? { displayedDateText: lead.deadline.slice(0, 80) } : {}),
      ...(lead.location ? { locationText: lead.location.slice(0, 120) } : {}),
      ...(lead.description ? { shortDescription: lead.description.slice(0, 280) } : {}),
      ...(lead.sourceRecordId ? { sourceRecordId: lead.sourceRecordId } : {}),
    },
  };
}

function looksLikeNavNoise(leads: GenericShadowLead[]): boolean {
  if (leads.length === 0) return false;
  const noisy = leads.filter((lead) =>
    /^(learn more|hackathons?|blog|the garden|host a hackathon|consultancy|about|home|login|sign in|menu|open|past|upcoming)$/i.test(
      lead.title.trim(),
    ),
  ).length;
  return noisy / leads.length >= 0.4;
}

function deterministicQualityOk(input: {
  leads: GenericShadowLead[];
  discovered: number;
  experiment: SourceExperiment;
}): boolean {
  if (input.leads.length === 0) return false;
  if (looksLikeNavNoise(input.leads)) return false;
  const quality = evaluateGenericExtractionQuality({
    discoveredRecords: input.discovered,
    leads: input.leads,
    experiment: input.experiment,
  });
  if (quality.estimatedPrecision < 0.85 || quality.validEventLeads < 2) return false;
  if (quality.dateCompleteness < 0.25 && input.leads.length >= 5) return false;
  const expected = input.experiment.expectedMinimumEventCount;
  if (expected && quality.validEventLeads < Math.min(expected, Math.max(15, Math.ceil(expected * 0.75)))) {
    return false;
  }
  return (
    quality.classification === "healthy_complete" ||
    quality.classification === "healthy_bounded" ||
    quality.classification === "usable_partial" ||
    quality.classification === "healthy" ||
    quality.classification === "usable"
  );
}

/**
 * Deterministic-first listing extraction.
 * AI group selection runs at most once per discovery cycle when provided.
 */
export async function extractListingCards(input: {
  artifacts: AcquiredArtifact[];
  experiment: SourceExperiment;
  selectedUnitSetId?: string;
  /** When true, AI may run once if deterministic extraction is weak. */
  allowAiSelection: boolean;
  /** Already used AI this discovery cycle. */
  aiAlreadyUsed?: boolean;
  signal?: AbortSignal;
}): Promise<CardExtractionResult> {
  const discovery = discoverGenericRecordSets(input.artifacts);
  const recordSets = mergeCompatibleRecordSets(discovery.recordSets);
  const schemaById = new Map(
    recordSets.map((recordSet) => [recordSet.recordSetId, inferGenericEventSchema(recordSet)]),
  );
  const validations = recordSets.map((recordSet) =>
    validateEventIntent({ recordSet, schema: schemaById.get(recordSet.recordSetId) }),
  );
  const viableLeadCounts = new Map<string, number>();
  const leadsById = new Map<string, GenericShadowLead[]>();
  for (const recordSet of recordSets) {
    const schema = schemaById.get(recordSet.recordSetId);
    const leads = schema ? normalizeGenericRecords(recordSet, schema, input.experiment) : [];
    leadsById.set(recordSet.recordSetId, leads);
    viableLeadCounts.set(recordSet.recordSetId, leads.length);
  }
  const selectedStructured = selectRecordSet(recordSets, viableLeadCounts);
  const structuredLeads = selectedStructured
    ? (leadsById.get(selectedStructured.recordSetId) ?? [])
    : [];

  let dom = runGenericDomExtraction(input.artifacts, input.experiment, {
    ...(input.selectedUnitSetId ? { selectedUnitSetId: input.selectedUnitSetId } : {}),
  });

  // When a directory inventory floor is known, prefer the largest clean repeated group
  // before declaring deterministic success (hackathons.space-style pages).
  if (
    !input.selectedUnitSetId &&
    input.experiment.expectedMinimumEventCount &&
    dom.repeatedUnitSets.length > 0
  ) {
    const ranked = [...dom.repeatedUnitSets]
      .filter(
        (unitSet) =>
          unitSet.confidence >= 0.45 &&
          unitSet.rejectionReasons.length === 0 &&
          unitSet.diagnostics.unitCount >= 5,
      )
      .sort((left, right) => right.diagnostics.unitCount - left.diagnostics.unitCount);
    const best = ranked[0];
    if (
      best &&
      best.unitSetId !== dom.selectedUnitSet?.unitSetId &&
      best.diagnostics.unitCount > (dom.selectedUnitSet?.diagnostics.unitCount ?? 0)
    ) {
      dom = runGenericDomExtraction(input.artifacts, input.experiment, {
        selectedUnitSetId: best.unitSetId,
        allowCompositeIdentity: true,
      });
    }
  }
  let strategy: CardExtractionDiagnostics["strategy"] = "none";
  let leads: GenericShadowLead[] = [];
  if (structuredLeads.length > 0 && deterministicQualityOk({
    leads: structuredLeads,
    discovered: selectedStructured?.records.length ?? 0,
    experiment: input.experiment,
  })) {
    strategy = "structured";
    leads = structuredLeads;
  } else if (
    dom.leads.length > 0 &&
    deterministicQualityOk({
      leads: dom.leads,
      discovered: dom.availableRecords ?? dom.leads.length,
      experiment: input.experiment,
    })
  ) {
    strategy = "dom";
    leads = dom.leads;
  } else if (dom.leads.length >= structuredLeads.length && dom.leads.length > 0) {
    strategy = "dom";
    leads = dom.leads;
  } else if (structuredLeads.length > 0) {
    strategy = "structured";
    leads = structuredLeads;
  }

  let aiSelectionUsed = false;
  let aiUnavailable = false;
  let aiInvoked = false;
  let selectedUnitSetId = input.selectedUnitSetId ?? dom.selectedUnitSet?.unitSetId;

  const needsAi =
    input.allowAiSelection &&
    !input.aiAlreadyUsed &&
    !deterministicQualityOk({
      leads,
      discovered: strategy === "dom" ? (dom.availableRecords ?? leads.length) : (selectedStructured?.records.length ?? 0),
      experiment: input.experiment,
    });

  if (needsAi) {
    if (!hasLlmConfig() && !process.env.LLM_API_KEY) {
      aiUnavailable = true;
    } else {
      const actionCandidates = input.artifacts
        .flatMap((artifact) => {
          const html = htmlFromArtifact(artifact);
          return html ? enumerateCandidateActionsFromHtml(html, artifact.sourceUrl) : [];
        })
        .slice(0, 20);
      const aiInput = buildAiPageDecisionInput({
        sourceUrl: input.experiment.inputUrl,
        artifacts: input.artifacts,
        recordSets,
        schemas: schemaById,
        validations,
        repeatedUnitSets: dom.repeatedUnitSets,
        actionCandidates,
      });
      const shouldRun =
        aiInput.candidateGroups.length > 0 &&
        (shouldInvokeAiPageDecision({
          deterministicValidEvents: 0,
          candidateGroups: aiInput.candidateGroups,
        }) ||
          aiInput.candidateGroups.some(
            (group) => group.kind === "dom" && group.recordCount >= 3,
          ) ||
          needsAi);

      if (!shouldRun) {
        // AI was required by quality gate but no selectable groups existed.
        aiUnavailable = aiInput.candidateGroups.length === 0;
      } else {
        aiInvoked = true;
        const ai = await requestAiPageDecision({
          sanitizedInput: aiInput,
          signal: input.signal,
        }).catch((error): {
          invoked: true;
          accepted: false;
          sanitizedInput: typeof aiInput;
          rejectedReasons: string[];
          decision?: undefined;
        } => ({
          invoked: true,
          accepted: false,
          sanitizedInput: aiInput,
          rejectedReasons: [error instanceof Error ? error.message : String(error)],
        }));
        const selectedGroup = ai.decision?.selectedGroupId
          ? aiInput.candidateGroups.find((group) => group.groupId === ai.decision?.selectedGroupId)
          : undefined;
        if (ai.accepted && ai.decision?.classification === "event_records" && selectedGroup?.kind === "dom") {
          const aiDom = runGenericDomExtraction(input.artifacts, input.experiment, {
            selectedUnitSetId: selectedGroup.groupId,
            allowCompositeIdentity: true,
          });
          const improves =
            aiDom.leads.length > leads.length ||
            (input.experiment.expectedMinimumEventCount !== undefined &&
              aiDom.leads.length >= Math.min(20, input.experiment.expectedMinimumEventCount) &&
              aiDom.leads.length >= leads.length);
          if (improves) {
            dom = aiDom;
            leads = aiDom.leads;
            strategy = "dom";
            selectedUnitSetId = selectedGroup.groupId;
            aiSelectionUsed = true;
          }
        } else if (!ai.accepted && /not configured/i.test(ai.rejectedReasons.join(" "))) {
          aiUnavailable = true;
        }
      }
    }
  }

  const quality = evaluateGenericExtractionQuality({
    discoveredRecords:
      strategy === "dom"
        ? (dom.availableRecords ?? leads.length)
        : (selectedStructured?.records.length ?? leads.length),
    leads,
    experiment: input.experiment,
  });

  return {
    leads,
    cards: leads.map(leadToCard),
    diagnostics: {
      strategy,
      deterministicOk: !aiSelectionUsed && leads.length > 0 && !aiUnavailable,
      aiSelectionUsed,
      aiUnavailable,
      aiInvoked,
      ...(selectedUnitSetId ? { selectedUnitSetId } : {}),
      discoveredRecords: quality.discoveredRecords,
      normalizedLeads: quality.normalizedLeads,
      validEventLeads: quality.validEventLeads,
      classification: quality.classification,
      ...(dom.selectedUnitSet
        ? {
            unitTag: dom.schema?.recordContainer.unitTag ?? "unknown",
            unitCount: dom.selectedUnitSet.diagnostics.unitCount,
          }
        : {}),
      sampleTitles: leads.slice(0, 3).map((lead) => lead.title),
    },
  };
}

export function artifactsSufficientForStatic(
  artifacts: AcquiredArtifact[],
  experiment: SourceExperiment,
): boolean {
  const discovery = discoverGenericRecordSets(artifacts);
  const recordSets = mergeCompatibleRecordSets(discovery.recordSets);
  const selected = recordSets.find(
    (recordSet) =>
      recordSet.confidence >= 0.5 &&
      recordSet.eventScore >= 0.35 &&
      recordSet.records.length >= 2,
  );
  if (selected) {
    const schema = inferGenericEventSchema(selected);
    const leads = schema ? normalizeGenericRecords(selected, schema, experiment) : [];
    if (!deterministicQualityOk({
      leads,
      discovered: selected.records.length,
      experiment,
    })) {
      return false;
    }
    const expected = experiment.expectedMinimumEventCount;
    if (expected && leads.length < Math.min(20, Math.ceil(expected * 0.2))) return false;
    return true;
  }
  const dom = runGenericDomExtraction(artifacts, experiment);
  if (!dom.selectedUnitSet || dom.leads.length < 2) return false;
  if (!deterministicQualityOk({
    leads: dom.leads,
    discovered: dom.availableRecords ?? dom.leads.length,
    experiment,
  })) {
    return false;
  }
  const expected = experiment.expectedMinimumEventCount;
  if (expected && dom.leads.length < Math.min(20, Math.ceil(expected * 0.2))) return false;
  return true;
}
