import { performance } from "node:perf_hooks";
import { buildDomRepresentations } from "@/experiments/scraper-v2/generic/domRepresentation";
import { detectRepeatedDomUnitSets } from "@/experiments/scraper-v2/generic/domRepeatedUnits";
import { inferDomSchemaAndLeads } from "@/experiments/scraper-v2/generic/domSchema";
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
    leads: inferred.leads,
    availableRecords: selectedUnitSet.diagnostics.unitCount,
    stopReason: inferred.schema ? "completed" : "schema_rejected",
    timings: { ...timings, totalMs: ms(totalStartedAt) },
  };
}
