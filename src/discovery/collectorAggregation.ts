import type {
  CollectorDiagnostics,
  CollectorResult,
  CollectorStatus,
} from "@/collectors/types";
import type { DiscoverySourceId, RawLead, SourceName } from "@/core/discovery/types";

export type SourceReturnAccounting = {
  source: DiscoverySourceId;
  status: CollectorStatus;
  discovered: number;
  returned: number;
  enriched: number;
  partial: number;
  dropped: number;
  durationMs: number;
  errors: number;
  warnings: number;
  stopReason?: string;
  safeMessage?: string;
};

export type CollectorAggregation = {
  results: CollectorResult[];
  leads: RawLead[];
  sourceReturns: SourceReturnAccounting[];
  discoveredTotal: number;
  returnedTotal: number;
  warnings: string[];
};

const SOURCE_NAMES = new Set<SourceName>([
  "hacklist",
  "hakku",
  "devpost",
  "mlh",
  "luma",
  "web",
  "x",
  "mock",
]);

function isSourceId(value: unknown): value is DiscoverySourceId {
  return (
    typeof value === "string" &&
    (SOURCE_NAMES.has(value as SourceName) || /^custom:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
  );
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function inferStatus(
  explicitStatus: CollectorStatus | undefined,
  errors: string[],
  warnings: string[],
): CollectorStatus {
  if (explicitStatus && explicitStatus !== "completed") return explicitStatus;
  if (errors.some((error) => /auth|login|sign[\s-]?in|session/i.test(error))) {
    return "auth_required";
  }
  if (errors.length > 0) return "failed";
  if (warnings.length > 0) return "degraded";
  return "completed";
}

export function normalizeCollectorResult(value: unknown): CollectorResult {
  if (!value || typeof value !== "object") {
    throw new Error("Collector returned a malformed result object.");
  }

  const result = value as Partial<CollectorResult>;
  if (!isSourceId(result.source)) {
    throw new Error("Collector returned a malformed result without a valid source.");
  }
  if (!Array.isArray(result.leads)) {
    throw new Error(`Collector ${result.source} returned a malformed result without leads[].`);
  }

  const errors = Array.isArray(result.errors) ? result.errors : [];
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const durationMs = asNumber(result.durationMs);
  const reportedReturned = asNumber(result.diagnostics?.returned, result.leads.length);
  if (reportedReturned > 0 && result.leads.length === 0) {
    throw new Error(
      `Collector ${result.source} contract violation: diagnostics returned=${reportedReturned}, but leads[] is empty.`,
    );
  }
  const diagnostics: CollectorDiagnostics = {
    discovered: asNumber(result.diagnostics?.discovered, result.leads.length),
    returned: reportedReturned,
    enriched: asNumber(result.diagnostics?.enriched),
    partial: asNumber(result.diagnostics?.partial),
    dropped: asNumber(result.diagnostics?.dropped),
    detectedUnits: result.diagnostics?.detectedUnits,
    candidateUnits: result.diagnostics?.candidateUnits,
    normalizedLeads: result.diagnostics?.normalizedLeads,
    rejectedDuringParsing: result.diagnostics?.rejectedDuringParsing,
    pagesTraversed: result.diagnostics?.pagesTraversed,
    extractionStrategy: result.diagnostics?.extractionStrategy,
    stopReason: result.diagnostics?.stopReason,
    safeMessage: result.diagnostics?.safeMessage,
  };
  diagnostics.returned = result.leads.length;
  diagnostics.discovered = Math.max(diagnostics.discovered, result.leads.length);
  diagnostics.dropped = Math.max(0, diagnostics.discovered - diagnostics.returned);

  const normalized: CollectorResult = {
    source: result.source,
    leads: result.leads,
    status: inferStatus(result.status, errors, warnings),
    diagnostics,
    errors,
    warnings,
    durationMs,
    metrics: result.metrics,
  };

  if (normalized.diagnostics.discovered > 0 && normalized.leads.length === 0) {
    normalized.status =
      normalized.status === "completed" ? "degraded" : normalized.status;
    normalized.warnings = [
      ...normalized.warnings,
      `Collector contract warning: ${normalized.diagnostics.discovered} discovered, 0 returned.`,
    ];
  }

  return normalized;
}

export function aggregateCollectorResults(values: unknown[]): CollectorAggregation {
  const warnings: string[] = [];
  const results = values.map((value) => normalizeCollectorResult(value));
  const leads = results.flatMap((result) => result.leads);
  const sourceReturns = results.map((result) => ({
    source: result.source,
    status: result.status,
    discovered: result.diagnostics.discovered,
    returned: result.leads.length,
    enriched: result.diagnostics.enriched,
    partial: result.diagnostics.partial,
    dropped: result.diagnostics.dropped,
    durationMs: result.durationMs,
    errors: result.errors.length,
    warnings: result.warnings.length,
    stopReason: result.diagnostics.stopReason,
    safeMessage: result.diagnostics.safeMessage,
  }));
  const discoveredTotal = sourceReturns.reduce((sum, item) => sum + item.discovered, 0);
  const returnedTotal = sourceReturns.reduce((sum, item) => sum + item.returned, 0);

  for (const item of sourceReturns) {
    if (item.discovered > 0 && item.returned === 0) {
      warnings.push(
        `[${item.source}] Collector reported ${item.discovered} discovered leads but returned 0.`,
      );
    }
  }

  return {
    results,
    leads,
    sourceReturns,
    discoveredTotal,
    returnedTotal,
    warnings,
  };
}
