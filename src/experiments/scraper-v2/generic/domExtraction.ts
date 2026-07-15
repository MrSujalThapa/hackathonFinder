import { performance } from "node:perf_hooks";
import { buildDomRepresentations } from "@/experiments/scraper-v2/generic/domRepresentation";
import { detectRepeatedDomUnitSets } from "@/experiments/scraper-v2/generic/domRepeatedUnits";
import { inferDomSchemaAndLeads } from "@/experiments/scraper-v2/generic/domSchema";
import { stableDedupeKey } from "@/experiments/scraper-v2/generic/valueUtils";
import type {
  AcquiredArtifact,
  DomExtractionResult,
  DomRepresentation,
  RepeatedUnitSet,
  SourceExperiment,
} from "@/experiments/scraper-v2/generic/types";

function ms(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function representationForUnitSet(
  representations: DomRepresentation[],
  unitSet: RepeatedUnitSet,
): DomRepresentation | undefined {
  return representations.find((representation) => representation.artifactId === unitSet.artifactId);
}

export function runGenericDomExtraction(
  artifacts: AcquiredArtifact[],
  experiment: SourceExperiment,
  options: { selectedUnitSetId?: string; allowCompositeIdentity?: boolean } = {},
): DomExtractionResult {
  const totalStartedAt = performance.now();
  const timings: Record<string, number> = {};

  const representationStartedAt = performance.now();
  const representations = buildDomRepresentations(artifacts);
  timings.domRepresentationMs = ms(representationStartedAt);
  if (representations.length === 0) {
    return {
      strategy: "dom",
      representations: [],
      repeatedUnitSets: [],
      leads: [],
      stopReason: "no_dom_artifact",
      timings: { ...timings, totalMs: ms(totalStartedAt) },
    };
  }

  const detectionStartedAt = performance.now();
  const repeatedUnitSets = detectRepeatedDomUnitSets(representations);
  timings.repeatedUnitDetectionMs = ms(detectionStartedAt);
  const selectedUnitSet = (options.selectedUnitSetId
    ? repeatedUnitSets.find((unitSet) => unitSet.unitSetId === options.selectedUnitSetId)
    : undefined) ?? repeatedUnitSets.find(
    (unitSet) =>
      unitSet.confidence >= 0.5 &&
      unitSet.rejectionReasons.length === 0 &&
      unitSet.diagnostics.unitCount >= 2,
  );
  if (!selectedUnitSet) {
    return {
      strategy: "dom",
      representations: representations.map((representation) => ({
        artifactId: representation.artifactId,
        nodeCount: representation.nodeCount,
        maxDepth: representation.maxDepth,
      })),
      repeatedUnitSets,
      leads: [],
      stopReason: "no_unit_set",
      timings: { ...timings, totalMs: ms(totalStartedAt) },
    };
  }

  const schemaStartedAt = performance.now();
  const representation = representationForUnitSet(representations, selectedUnitSet);
  const inferred = representation
    ? inferDomSchemaAndLeads({ representation, unitSet: selectedUnitSet, experiment, allowCompositeIdentity: options.allowCompositeIdentity })
    : { leads: [], rejectionReasons: ["missing representation for selected unit set"] };
  timings.domSchemaInferenceMs = ms(schemaStartedAt);

  let leads = inferred.leads;
  let availableRecords = selectedUnitSet.diagnostics.unitCount;
  if (inferred.schema) {
    const leadByKey = new Map<string, typeof leads[number]>();
    const compatibleUnitSetIds = new Set([selectedUnitSet.unitSetId]);
    for (const lead of leads) {
      leadByKey.set(stableDedupeKey([lead.sourceRecordId, lead.canonicalUrl, lead.title, lead.startDate]), lead);
    }
    for (const unitSet of repeatedUnitSets) {
      if (unitSet.unitSetId === selectedUnitSet.unitSetId) continue;
      const candidateRepresentation = representationForUnitSet(representations, unitSet);
      if (!candidateRepresentation) continue;
      const candidate = inferDomSchemaAndLeads({
        representation: candidateRepresentation,
        unitSet,
        experiment,
        allowCompositeIdentity: options.allowCompositeIdentity,
      });
      if (!candidate.schema) continue;
      const compatible =
        candidate.schema.recordContainer.unitTag === inferred.schema.recordContainer.unitTag &&
        candidate.schema.recordContainer.unitClassShape === inferred.schema.recordContainer.unitClassShape &&
        candidate.schema.validationMetrics.titleCompleteness >= 0.6 &&
        candidate.schema.validationMetrics.identityCompleteness >= 0.5;
      if (!compatible) continue;
      compatibleUnitSetIds.add(unitSet.unitSetId);
      for (const lead of candidate.leads) {
        leadByKey.set(stableDedupeKey([lead.sourceRecordId, lead.canonicalUrl, lead.title, lead.startDate]), lead);
      }
    }
    leads = [...leadByKey.values()];
    availableRecords = repeatedUnitSets
      .filter((unitSet) => compatibleUnitSetIds.has(unitSet.unitSetId))
      .reduce((total, unitSet) => total + unitSet.diagnostics.unitCount, 0);
  }

  return {
    strategy: "dom",
    representations: representations.map((item) => ({
      artifactId: item.artifactId,
      nodeCount: item.nodeCount,
      maxDepth: item.maxDepth,
    })),
    repeatedUnitSets,
    selectedUnitSet,
    ...(inferred.schema ? { schema: inferred.schema } : {}),
    leads,
    availableRecords,
    stopReason: inferred.schema ? "completed" : "schema_rejected",
    timings: { ...timings, totalMs: ms(totalStartedAt) },
  };
}
