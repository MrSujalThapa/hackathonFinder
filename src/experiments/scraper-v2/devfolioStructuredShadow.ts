import { performance } from "node:perf_hooks";
import {
  acquireStructuredArtifacts,
  type ArtifactAcquisitionResult,
} from "@/experiments/scraper-v2/acquireStructuredArtifacts";
import {
  discoverRecordArrays,
  readArrayAtPath,
} from "@/experiments/scraper-v2/discoverRecordArrays";
import { normalizeStructuredRecords } from "@/experiments/scraper-v2/normalizeStructuredRecords";
import { evaluateExtractionQuality } from "@/experiments/scraper-v2/evaluateExtractionQuality";
import type {
  CandidateArrayDiagnostic,
  DevfolioShadowResult,
  ShadowLead,
  StructuredArtifact,
} from "@/experiments/scraper-v2/types";
import { DEVFOLIO_CONFIG } from "@/experiments/scraper-v2/devfolioConfig";

function ms(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function selectedArrays(arrays: CandidateArrayDiagnostic[]): CandidateArrayDiagnostic[] {
  return arrays
    .filter((array) => array.confidence >= 0.55 && array.recordCount >= 2)
    .slice(0, 3);
}

function recordsFor(artifacts: StructuredArtifact[], diagnostic: CandidateArrayDiagnostic): unknown[] {
  const artifact = artifacts.find(
    (item) => item.label === diagnostic.artifact && item.kind === diagnostic.artifactKind,
  );
  if (!artifact) return [];
  return readArrayAtPath(artifact.payload, diagnostic.path) ?? [];
}

function dedupeLeads(leads: ShadowLead[]): ShadowLead[] {
  const seen = new Set<string>();
  const out: ShadowLead[] = [];
  for (const lead of leads) {
    const key = lead.sourceRecordId ?? lead.canonicalUrl ?? `${lead.title}|${lead.startDate ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(lead);
  }
  return out;
}

export async function runDevfolioStructuredShadow(
  acquisition?: ArtifactAcquisitionResult,
): Promise<DevfolioShadowResult> {
  const totalStartedAt = performance.now();
  const timings: Record<string, number> = {};

  const artifactStartedAt = performance.now();
  const acquired = acquisition ?? (await acquireStructuredArtifacts(DEVFOLIO_CONFIG.listingUrl));
  timings.artifactAcquisitionMs = acquisition ? acquisition.durationMs : ms(artifactStartedAt);

  const scanningStartedAt = performance.now();
  const arrays = discoverRecordArrays(acquired.artifacts);
  timings.structuredScanningMs = ms(scanningStartedAt);

  const mappingStartedAt = performance.now();
  const selected = selectedArrays(arrays);
  const selectedRecords = selected.flatMap((diagnostic) => recordsFor(acquired.artifacts, diagnostic));
  timings.fieldMappingMs = ms(mappingStartedAt);

  const normalizationStartedAt = performance.now();
  const leads = dedupeLeads(
    selected.flatMap((diagnostic) =>
      normalizeStructuredRecords(recordsFor(acquired.artifacts, diagnostic), diagnostic),
    ),
  );
  timings.normalizationMs = ms(normalizationStartedAt);

  const qualityStartedAt = performance.now();
  const quality = evaluateExtractionQuality({
    arrays,
    selectedArrays: selected,
    leads,
    durationMs: ms(totalStartedAt),
    acquisitionMode: acquired.mode,
    requestsMade: acquired.requestsMade,
  });
  timings.qualityEvaluationMs = ms(qualityStartedAt);
  timings.totalMs = ms(totalStartedAt);

  return {
    url: acquired.finalUrl,
    artifacts: acquired.artifacts.map((artifact) => ({
      kind: artifact.kind,
      label: artifact.label,
      byteLength: artifact.byteLength,
    })),
    candidateArrays: arrays,
    selectedArray: selected[0],
    leads,
    quality: {
      ...quality,
      structuredRecordCount: selectedRecords.length,
      extractionDurationMs: timings.totalMs,
    },
    timings,
    persistenceDisabled: true,
  };
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function seconds(msValue: number | undefined): string {
  return `${((msValue ?? 0) / 1000).toFixed(1)}s`;
}

export function formatDevfolioShadowResult(result: DevfolioShadowResult): string[] {
  const lines = ["[shadow-v2:devfolio] Structured shadow experiment"];
  lines.push(`  artifact acquisition      ${seconds(result.timings.artifactAcquisitionMs)}`);
  lines.push(`  __NEXT_DATA__              ${result.artifacts.some((item) => item.kind === "next_data") ? "found" : "missing"}`);
  lines.push(`  candidate arrays           ${result.candidateArrays.length}`);
  lines.push(`  selected path              ${result.selectedArray?.path ?? "none"}`);
  lines.push(`  structured records         ${result.quality.structuredRecordCount}`);
  lines.push(`  normalized leads           ${result.quality.normalizedLeadCount}`);
  lines.push(`  valid event URLs           ${result.leads.filter((lead) => lead.canonicalUrl).length}`);
  lines.push(`  obvious non-events         ${result.quality.obviousNonEventCount}`);
  lines.push(`  title completeness         ${pct(result.quality.titleCompleteness)}`);
  lines.push(`  URL completeness           ${pct(result.quality.urlCompleteness)}`);
  lines.push(`  duplicate rate             ${pct(result.quality.duplicateRate)}`);
  lines.push(`  V2 total                   ${seconds(result.timings.totalMs)}`);
  lines.push("  persistence                disabled");
  if (result.leads.length > 0) {
    lines.push("");
    lines.push("Shadow leads:");
    for (const lead of result.leads.slice(0, 25)) {
      lines.push(`- ${lead.title}${lead.canonicalUrl ? ` - ${lead.canonicalUrl}` : ""}`);
    }
  }
  return lines;
}
