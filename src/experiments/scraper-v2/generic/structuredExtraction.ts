import { performance } from "node:perf_hooks";
import { acquireGenericArtifacts } from "@/experiments/scraper-v2/generic/acquisition";
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
  GenericStructuredExtractionResult,
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

function selectRecordSet(discovery: RecordDiscoveryResult): CandidateRecordSet | undefined {
  return discovery.recordSets.find(
    (recordSet) =>
      recordSet.confidence >= 0.5 &&
      recordSet.eventScore >= 0.35 &&
      recordSet.records.length >= 2 &&
      recordSet.duplicateRate <= 0.45,
  );
}

function staticArtifactsSufficient(artifacts: AcquiredArtifact[]): boolean {
  const discovery = discoverGenericRecordSets(artifacts);
  const selected = selectRecordSet(discovery);
  return Boolean(selected);
}

export async function runGenericStructuredExtraction(
  experiment: SourceExperiment,
): Promise<GenericStructuredExtractionResult> {
  const totalStartedAt = performance.now();
  const timings: Record<string, number> = {};

  const acquisitionStartedAt = performance.now();
  const acquisition = await acquireGenericArtifacts(experiment, staticArtifactsSufficient);
  timings.staticAndBrowserAcquisitionMs = ms(acquisitionStartedAt);

  const discoveryStartedAt = performance.now();
  const discovery = discoverGenericRecordSets(acquisition.artifacts);
  timings.recordSetDiscoveryMs = ms(discoveryStartedAt);

  const selected = selectRecordSet(discovery);
  const schemaStartedAt = performance.now();
  const schema = selected ? inferGenericEventSchema(selected) : undefined;
  timings.fieldInferenceMs = ms(schemaStartedAt);

  const normalizationStartedAt = performance.now();
  const leads = selected && schema ? normalizeGenericRecords(selected, schema, experiment) : [];
  timings.normalizationMs = ms(normalizationStartedAt);

  const paginationStartedAt = performance.now();
  const pagination = inferGenericPagination(selected);
  timings.paginationMs = ms(paginationStartedAt);

  const qualityStartedAt = performance.now();
  const quality = evaluateGenericExtractionQuality({
    discoveredRecords: selected?.records.length ?? 0,
    leads,
    experiment,
    blockedReason: acquisition.diagnostics.blockedReason,
    schemaRejected: schema?.rejected,
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
    ...(schema ? { schema } : {}),
    leads,
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
  lines.push(`  artifacts                 ${result.artifacts.length}`);
  lines.push(`  requests                  ${result.acquisition.requestsMade}`);
  lines.push(`  browser pages             ${result.acquisition.browserPages}`);
  lines.push(`  bytes inspected           ${result.counters.bytesInspected}`);
  lines.push(`  arrays scanned            ${result.counters.arraysScanned}`);
  lines.push(`  records inspected         ${result.counters.recordsInspected}`);
  lines.push(`  selected artifact         ${result.selectedRecordSet?.artifactKind ?? "none"}`);
  lines.push(`  selected path             ${result.selectedRecordSet?.path ?? "none"}`);
  lines.push(`  selected records          ${result.selectedRecordSet?.records ?? 0}`);
  lines.push(`  field inference           ${seconds(result.timings.fieldInferenceMs)}`);
  lines.push(`  normalized leads          ${result.quality.normalizedLeads}`);
  lines.push(`  valid events              ${result.quality.validEventLeads}`);
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
