import { performance } from "node:perf_hooks";
import { ExistingCustomRuntime } from "@/experiments/scraper-v2/generic/crawlRuntime";
import { runGenericDomExtraction } from "@/experiments/scraper-v2/generic/domExtraction";
import { validateEventIntent } from "@/experiments/scraper-v2/generic/eventIntentValidation";
import { inferGenericEventSchema } from "@/experiments/scraper-v2/generic/fieldInference";
import { normalizeGenericRecords } from "@/experiments/scraper-v2/generic/normalization";
import { inferGenericPagination } from "@/experiments/scraper-v2/generic/pagination";
import { evaluateGenericExtractionQuality } from "@/experiments/scraper-v2/generic/quality";
import {
  discoverGenericRecordSets,
  type RecordDiscoveryResult,
} from "@/experiments/scraper-v2/generic/recordDiscovery";
import type {
  AcquiredArtifact,
  CandidateRecordSet,
  CrawlRuntime,
  DiscoveryBudget,
  EventIntentValidation,
  GenericStructuredExtractionResult,
  InferredEventSchema,
  SourceExperiment,
} from "@/experiments/scraper-v2/generic/types";

function ms(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function summarizeRecordSet(recordSet: CandidateRecordSet): Omit<CandidateRecordSet, "records"> & { records: number } {
  return {
    ...recordSet,
    records: recordSet.records.length,
  };
}

function mergeCompatibleRecordSets(discovery: RecordDiscoveryResult): RecordDiscoveryResult {
  const merged = new Map<string, CandidateRecordSet>();
  for (const recordSet of discovery.recordSets) {
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
  return {
    ...discovery,
    recordSets: [...merged.values()].sort((left, right) => right.confidence - left.confidence),
  };
}

function estimateAvailableRecords(
  artifacts: AcquiredArtifact[],
  selected: CandidateRecordSet | undefined,
): number | undefined {
  let estimate = selected?.records.length;
  function inspect(value: unknown, depth = 0): void {
    if (depth > 5 || value == null) return;
    if (Array.isArray(value)) {
      estimate = Math.max(estimate ?? 0, value.length);
      value.slice(0, 8).forEach((item) => inspect(item, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/\b(total|total_count|totalCount|available)\b/.test(key) && typeof child === "number" && child > 0) {
        estimate = Math.max(estimate ?? 0, child);
      }
      inspect(child, depth + 1);
    }
  }
  artifacts.forEach((artifact) => inspect(artifact.payload));
  return estimate;
}

function selectRecordSet(
  discovery: RecordDiscoveryResult,
  validations?: EventIntentValidation[],
  viableLeadCounts?: Map<string, number>,
): CandidateRecordSet | undefined {
  const validationById = new Map(validations?.map((validation) => [validation.recordSetId, validation]));
  const candidates = discovery.recordSets
    .filter((recordSet) => {
      if (recordSet.rejectionReasons.some((reason) => /sponsor-only|filter\/facet-like|form\/questionnaire-like/i.test(reason))) {
        return false;
      }
      const viableLeadCount = viableLeadCounts?.get(recordSet.recordSetId);
      if (viableLeadCounts && (viableLeadCount ?? 0) <= 0) return false;
      const validation = validationById.get(recordSet.recordSetId);
      if (validation) {
        return (
          (validation.classification === "healthy" || validation.classification === "usable") &&
          validation.eventIntentScore >= 0.58 &&
          validation.identityScore >= 0.5 &&
          recordSet.records.length >= 2
        );
      }
      return (
        recordSet.confidence >= 0.5 &&
        recordSet.eventScore >= 0.35 &&
        recordSet.records.length >= 2 &&
        recordSet.duplicateRate <= 0.45
      );
    })
    .sort((left, right) => {
      const leftViable = viableLeadCounts?.get(left.recordSetId) ?? 0;
      const rightViable = viableLeadCounts?.get(right.recordSetId) ?? 0;
      if (leftViable !== rightViable) return rightViable - leftViable;
      const leftValidation = validationById.get(left.recordSetId);
      const rightValidation = validationById.get(right.recordSetId);
      const leftScore = (leftValidation?.eventIntentScore ?? left.confidence) + (leftValidation?.identityScore ?? 0) * 0.25;
      const rightScore = (rightValidation?.eventIntentScore ?? right.confidence) + (rightValidation?.identityScore ?? 0) * 0.25;
      return rightScore - leftScore;
    });
  return candidates[0];
}

function staticArtifactsSufficientForExperiment(experiment: SourceExperiment, artifacts: AcquiredArtifact[]): boolean {
  const discovery = mergeCompatibleRecordSets(discoverGenericRecordSets(artifacts));
  const selected = selectRecordSet(discovery);
  if (!selected) return false;
  const expected = experiment.expectedMinimumEventCount;
  if (expected && selected.records.length < Math.min(20, Math.ceil(expected * 0.2))) return false;
  return true;
}

function selectExtractionStrategy(input: {
  structuredLeads: GenericStructuredExtractionResult["leads"];
  structuredDiscoveredRecords: number;
  structuredSchemaRejected?: boolean;
  dom: NonNullable<GenericStructuredExtractionResult["dom"]>;
  experiment: SourceExperiment;
  blockedReason?: string;
}): GenericStructuredExtractionResult["strategySelected"] {
  if (input.dom.leads.length === 0 && input.structuredLeads.length === 0) return "none";
  if (input.dom.leads.length === 0) return "structured";
  if (input.structuredLeads.length === 0) return "dom";

  const structuredQuality = evaluateGenericExtractionQuality({
    discoveredRecords: input.structuredDiscoveredRecords,
    leads: input.structuredLeads,
    experiment: input.experiment,
    blockedReason: input.blockedReason,
    schemaRejected: input.structuredSchemaRejected,
  });
  const domQuality = evaluateGenericExtractionQuality({
    discoveredRecords: input.dom.availableRecords ?? input.dom.leads.length,
    leads: input.dom.leads,
    experiment: input.experiment,
    blockedReason: input.blockedReason,
    schemaRejected: input.dom.stopReason === "schema_rejected",
  });

  const domPrecisionAdvantage = domQuality.estimatedPrecision - structuredQuality.estimatedPrecision;
  const structuredLowPrecision = structuredQuality.classification === "degraded_low_precision";
  const domUsable = domQuality.validEventLeads > 0 && domQuality.estimatedPrecision >= 0.9;
  if (domUsable && (structuredLowPrecision || domPrecisionAdvantage >= 0.2)) return "dom";

  return domQuality.validEventLeads > structuredQuality.validEventLeads ? "dom" : "structured";
}

export async function runGenericStructuredExtraction(
  experiment: SourceExperiment,
  options: { runtime?: CrawlRuntime; budget?: DiscoveryBudget; signal?: AbortSignal; checkpointDir?: string } = {},
): Promise<GenericStructuredExtractionResult> {
  const totalStartedAt = performance.now();
  const timings: Record<string, number> = {};

  const acquisitionStartedAt = performance.now();
  const runtime = options.runtime ?? new ExistingCustomRuntime();
  const acquisition = await runtime.crawl({
    experiment,
    budget: options.budget,
    signal: options.signal,
    checkpointDir: options.checkpointDir,
    staticArtifactsSufficient: (artifacts) => staticArtifactsSufficientForExperiment(experiment, artifacts),
  });
  timings.staticAndBrowserAcquisitionMs = ms(acquisitionStartedAt);

  const discoveryStartedAt = performance.now();
  const discovery = mergeCompatibleRecordSets(discoverGenericRecordSets(acquisition.artifacts));
  timings.recordSetDiscoveryMs = ms(discoveryStartedAt);

  const schemaStartedAt = performance.now();
  const schemaByRecordSet = new Map<string, InferredEventSchema>();
  for (const recordSet of discovery.recordSets) {
    schemaByRecordSet.set(recordSet.recordSetId, inferGenericEventSchema(recordSet));
  }
  const eventIntentValidations = discovery.recordSets.map((recordSet) =>
    validateEventIntent({ recordSet, schema: schemaByRecordSet.get(recordSet.recordSetId) }),
  );
  const leadsByRecordSet = new Map<string, GenericStructuredExtractionResult["leads"]>();
  const viableLeadCounts = new Map<string, number>();
  for (const recordSet of discovery.recordSets) {
    const recordSchema = schemaByRecordSet.get(recordSet.recordSetId);
    const recordLeads = recordSchema ? normalizeGenericRecords(recordSet, recordSchema, experiment) : [];
    leadsByRecordSet.set(recordSet.recordSetId, recordLeads);
    viableLeadCounts.set(recordSet.recordSetId, recordLeads.length);
  }
  const selected = selectRecordSet(discovery, eventIntentValidations, viableLeadCounts);
  const schema = selected ? schemaByRecordSet.get(selected.recordSetId) : undefined;
  timings.fieldInferenceMs = ms(schemaStartedAt);

  const normalizationStartedAt = performance.now();
  const structuredLeads = selected ? leadsByRecordSet.get(selected.recordSetId) ?? [] : [];
  timings.normalizationMs = ms(normalizationStartedAt);

  const domStartedAt = performance.now();
  const dom = runGenericDomExtraction(acquisition.artifacts, experiment);
  timings.domInferenceMs = ms(domStartedAt);

  const strategySelected = selectExtractionStrategy({
    structuredLeads,
    structuredDiscoveredRecords: selected?.records.length ?? 0,
    structuredSchemaRejected: schema?.rejected,
    dom,
    experiment,
    blockedReason: acquisition.diagnostics.blockedReason,
  });
  const leads = strategySelected === "dom" ? dom.leads : structuredLeads;

  const paginationStartedAt = performance.now();
  const pagination = inferGenericPagination(selected);
  timings.paginationMs = ms(paginationStartedAt);

  const qualityStartedAt = performance.now();
  const quality = evaluateGenericExtractionQuality({
    discoveredRecords: strategySelected === "dom" ? dom.availableRecords ?? dom.leads.length : selected?.records.length ?? 0,
    leads,
    experiment,
    blockedReason: acquisition.diagnostics.blockedReason,
    schemaRejected: strategySelected === "dom" ? dom.stopReason === "schema_rejected" : schema?.rejected,
    estimatedAvailableRecords: estimateAvailableRecords(acquisition.artifacts, selected),
    sourceExhausted: acquisition.diagnostics.paginationStopReason === "no_growth",
    capReached:
      acquisition.diagnostics.paginationStopReason === "page_cap" ||
      acquisition.diagnostics.paginationStopReason === "request_cap",
  });
  timings.qualityEvaluationMs = ms(qualityStartedAt);
  timings.totalMs = ms(totalStartedAt);

  return {
    inputUrl: experiment.inputUrl,
    finalUrl: acquisition.diagnostics.finalUrl,
    acquisitionMode: acquisition.artifacts.some((artifact) => artifact.acquisitionMode === "browser")
      ? "browser"
      : "static",
    artifacts: acquisition.artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      kind: artifact.kind,
      sourceUrl: artifact.sourceUrl,
      byteSize: artifact.byteSize,
      acquisitionMode: artifact.acquisitionMode,
    })),
    acquisition: acquisition.diagnostics,
    candidateRecordSets: discovery.recordSets.slice(0, 12).map(summarizeRecordSet),
    ...(selected ? { selectedRecordSet: summarizeRecordSet(selected) } : {}),
    eventIntentValidations,
    ...(schema ? { schema } : {}),
    leads,
    strategySelected,
    dom,
    pagination,
    quality,
    timings,
    counters: {
      arraysScanned: discovery.arraysScanned,
      recordsInspected: discovery.recordsInspected,
      bytesInspected: acquisition.diagnostics.bytesInspected,
    },
    persistenceDisabled: true,
  };
}

function seconds(value: number | undefined): string {
  return `${((value ?? 0) / 1000).toFixed(1)}s`;
}

function pct(value: number | undefined): string {
  return `${Math.round((value ?? 0) * 100)}%`;
}

export function formatGenericStructuredExtractionResult(
  result: GenericStructuredExtractionResult,
): string[] {
  const lines = ["[structured-v2] Generic structured extraction"];
  lines.push(`  input                     ${result.inputUrl}`);
  lines.push(`  final URL                 ${result.finalUrl}`);
  lines.push(`  static/browser            ${result.acquisitionMode}`);
  lines.push(`  runtime                   ${result.acquisition.runtime ?? "custom"}`);
  lines.push(`  artifacts                 ${result.artifacts.length}`);
  lines.push(`  requests                  ${result.acquisition.requestsMade}`);
  lines.push(`  queue requests added      ${result.acquisition.queueRequestsAdded ?? 0}`);
  lines.push(`  queue duplicates          ${result.acquisition.queueDuplicateRequests ?? 0}`);
  lines.push(`  retries attempted         ${result.acquisition.retriesAttempted ?? 0}`);
  lines.push(`  pages requested           ${result.acquisition.pagesRequested ?? 1}`);
  lines.push(`  pagination executed       ${result.acquisition.paginationExecuted ? "yes" : "no"}`);
  lines.push(`  pagination stop           ${result.acquisition.paginationStopReason ?? "unknown"}`);
  lines.push(`  browser escalated         ${result.acquisition.browserEscalated ? "yes" : "no"}`);
  lines.push(`  actions discovered        ${result.acquisition.actionsDiscovered ?? 0}`);
  lines.push(`  actions executed          ${result.acquisition.actionsExecuted ?? 0}`);
  if (result.acquisition.identitiesAfterActions?.length) {
    lines.push(`  identities after actions  ${result.acquisition.identitiesAfterActions.join(", ")}`);
  }
  lines.push(`  checkpoint loaded         ${result.acquisition.checkpointLoaded ? "yes" : "no"}`);
  lines.push(`  checkpoint saved          ${result.acquisition.checkpointSaved ? "yes" : "no"}`);
  lines.push(`  browser pages             ${result.acquisition.browserPages}`);
  lines.push(`  bytes inspected           ${result.counters.bytesInspected}`);
  lines.push(`  arrays scanned            ${result.counters.arraysScanned}`);
  lines.push(`  records inspected         ${result.counters.recordsInspected}`);
  lines.push(`  selected artifact         ${result.selectedRecordSet?.artifactKind ?? "none"}`);
  lines.push(`  selected path             ${result.selectedRecordSet?.path ?? "none"}`);
  lines.push(`  selected records          ${result.selectedRecordSet?.records ?? 0}`);
  lines.push(`  strategy selected         ${result.strategySelected}`);
  lines.push(`  DOM unit sets             ${result.dom?.repeatedUnitSets.length ?? 0}`);
  lines.push(`  DOM selected units        ${result.dom?.selectedUnitSet?.diagnostics.unitCount ?? 0}`);
  lines.push(`  field inference           ${seconds(result.timings.fieldInferenceMs)}`);
  lines.push(`  normalized leads          ${result.quality.normalizedLeads}`);
  lines.push(`  valid events              ${result.quality.validEventLeads}`);
  lines.push(`  estimated available       ${result.quality.estimatedAvailableRecords ?? "unknown"}`);
  lines.push(`  estimated recall          ${pct(result.quality.estimatedRecall)}`);
  lines.push(`  obvious non-events        ${result.quality.obviousNonEvents}`);
  lines.push(`  title completeness        ${pct(result.quality.titleCompleteness)}`);
  lines.push(`  URL completeness          ${pct(result.quality.urlCompleteness)}`);
  lines.push(`  date completeness         ${pct(result.quality.dateCompleteness)}`);
  lines.push(`  duplicate rate            ${pct(result.quality.duplicateRate)}`);
  lines.push(`  pagination                ${result.pagination.method}`);
  lines.push(`  total                     ${seconds(result.timings.totalMs)}`);
  lines.push(`  quality                   ${result.quality.classification}`);
  lines.push("  persistence               disabled");
  if (result.quality.degradedReasons.length > 0) {
    lines.push(`  degraded reasons          ${result.quality.degradedReasons.join("; ")}`);
  }
  return lines;
}
