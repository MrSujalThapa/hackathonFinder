import type { CollectorResult } from "@/collectors/types";
import type {
  DiscoverySourceId,
  InventoryEstimate,
  SourceRunStats,
  SourceRunTelemetry,
} from "@/core/discovery/types";

export type { InventoryEstimate, SourceRunTelemetry };

export const SOURCE_TELEMETRY_MAX_ITEM_BYTES = 2_048;
export const SOURCE_TELEMETRY_MAX_ARRAY_BYTES = 16_384;
export const SOURCE_TELEMETRY_URL_MAX = 512;
export const SOURCE_TELEMETRY_REASON_MAX = 120;

const KERNEL_VERSION_PLACEHOLDER = "pre-kernel";
const ADAPTER_VERSION = "a1-metrics-1";

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function warningValue(warnings: string[], key: string): string | undefined {
  const prefix = `${key}=`;
  const hit = warnings.find((warning) => warning.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function warningNumber(warnings: string[], key: string): number | undefined {
  const raw = warningValue(warnings, key);
  if (raw == null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function outcomeToSourceState(outcome: SourceRunStats["outcome"]): string {
  switch (outcome) {
    case "executed":
      return "executed";
    case "degraded":
      return "degraded";
    case "failed":
      return "failed";
    case "auth_required":
      return "blocked_authentication";
    case "skipped":
      return "skipped";
    default:
      return "unknown";
  }
}

function inferMechanism(
  source: DiscoverySourceId,
  result: CollectorResult,
): SourceRunTelemetry["mechanism"] {
  const stop = result.diagnostics.stopReason ?? "";
  if (source === "devpost" || /api/i.test(stop)) return "api";
  if (source === "luma" || source === "hakku" || /scroll/i.test(stop)) return "scroll";
  if (source === "hacklist" || source === "mlh") return "static";
  if (/next/i.test(stop)) return "next";
  return "unknown";
}

function inferAcquisitionScope(
  source: DiscoverySourceId,
  result: CollectorResult,
): string {
  const fromWarning = warningValue(result.warnings, "acquisition_scope");
  if (fromWarning) return fromWarning;
  if (source === "devpost") {
    const requested = result.warnings.find((w) => /page_1_requested=/.test(w));
    if (requested?.includes("status[]=")) return "open_upcoming_api_subset";
    return "full_directory_api";
  }
  if (source === "luma") return "multi_feed_public_events";
  return "unknown";
}

/**
 * Directory inventory estimate. For Devpost, prefer API meta.total_count when present,
 * and never imply full-directory scope from an open+upcoming subset.
 */
export function inferInventoryEstimate(
  source: DiscoverySourceId,
  result: CollectorResult,
): InventoryEstimate | undefined {
  const scope = inferAcquisitionScope(source, result);
  const metaTotal = result.metrics?.metaTotalCount;
  const unique =
    typeof result.metrics?.uniqueCards === "number"
      ? result.metrics.uniqueCards
      : typeof result.metrics?.finalCardCount === "number"
        ? result.metrics.finalCardCount
        : result.diagnostics.discovered || result.leads.length;
  if (!Number.isFinite(unique) && !(typeof metaTotal === "number" && metaTotal > 0)) {
    return undefined;
  }

  const stop = `${result.diagnostics.stopReason ?? ""} ${result.warnings.join(" ")}`;
  const exhausted =
    /no_additional_cards|no_next_page|no_growth|exhausted|completed|end_marker/i.test(stop) &&
    !/maximum_cards_reached|maximum_pages_reached|maximum_scrolls|timeout|capped|safety_|target_reached/i.test(
      stop,
    );

  if (source === "devpost" && typeof metaTotal === "number" && metaTotal > 0) {
    return {
      value: metaTotal,
      method: "api_total",
      confidence: scope === "open_upcoming_api_subset" ? "strong" : "strong",
    };
  }
  if (source === "devpost" && exhausted) {
    return { value: unique, method: "api_total", confidence: "strong" };
  }
  if ((source === "luma" || source === "hakku") && exhausted) {
    return { value: unique, method: "scroll_plateau", confidence: "strong" };
  }
  if (/maximum_cards_reached|maximum_pages_reached|maximum_scrolls/i.test(stop)) {
    return { value: unique, method: "pagination_derived", confidence: "weak" };
  }
  if (unique > 0) return { value: unique, method: "unknown", confidence: "weak" };
  return undefined;
}

export function buildSourceTelemetry(input: {
  stats: SourceRunStats;
  result?: CollectorResult;
  listingDurationMs?: number;
  detailDurationMs?: number;
}): SourceRunTelemetry {
  const { stats, result } = input;
  const warnings = result?.warnings ?? stats.warnings;
  const collectedUnique =
    typeof result?.metrics?.uniqueCards === "number"
      ? result.metrics.uniqueCards
      : (result?.diagnostics.discovered ?? stats.leadsFound);
  const enriched =
    typeof result?.metrics?.detailPagesOpened === "number"
      ? result.metrics.detailPagesOpened
      : (result?.diagnostics.enriched ?? 0);
  const pagesOrScrolls =
    typeof result?.metrics?.pagesFetched === "number"
      ? result.metrics.pagesFetched
      : typeof result?.metrics?.scrollAttempts === "number"
        ? result.metrics.scrollAttempts
        : (result?.diagnostics.pagesTraversed ?? 0);
  const stopReason =
    result?.diagnostics.stopReason ??
    warningValue(warnings, "stop_reason") ??
    stats.outcome;
  const stopEvidence =
    warningValue(warnings, "stop_evidence") ??
    (/timeout/i.test(String(stopReason))
      ? "source_timeout_not_source_exhaustion"
      : /target_reached/i.test(String(stopReason))
        ? `profile_target_reached:${warningValue(warnings, "target_for_profile") ?? "unknown"}`
        : /maximum_cards|maximum_pages|maximum_scrolls/i.test(String(stopReason))
          ? "safety_budget_reached_not_source_exhaustion"
          : String(stopReason));
  const acquisitionScope = result
    ? inferAcquisitionScope(stats.source, result)
    : "unknown";
  const listingDurationMs =
    input.listingDurationMs ??
    result?.metrics?.listingDurationMs ??
    warningNumber(warnings, "listing_duration_ms") ??
    stats.durationMs;
  const detailDurationMs =
    input.detailDurationMs ??
    result?.metrics?.detailDurationMs ??
    warningNumber(warnings, "detail_duration_ms") ??
    0;
  const targetForProfile =
    typeof result?.metrics?.targetForProfile === "number"
      ? result.metrics.targetForProfile
      : warningNumber(warnings, "target_for_profile");
  const targetReached =
    typeof result?.metrics?.targetReached === "number"
      ? result.metrics.targetReached > 0
      : warningValue(warnings, "target_reached") === "true"
        ? true
        : targetForProfile != null
          ? collectedUnique >= targetForProfile
          : undefined;
  const directoryReportedTotal =
    typeof result?.metrics?.directoryReportedTotal === "number"
      ? result.metrics.directoryReportedTotal
      : typeof result?.metrics?.metaTotalCount === "number"
        ? result.metrics.metaTotalCount
        : warningNumber(warnings, "directory_reported_total") ??
          warningNumber(warnings, "meta_total_count");

  const telemetry: SourceRunTelemetry = {
    source: stats.source,
    adapterId: String(stats.source),
    adapterVersion: ADAPTER_VERSION,
    kernelVersion: KERNEL_VERSION_PLACEHOLDER,
    mechanism: result ? inferMechanism(stats.source, result) : "unknown",
    requestedUrl: "",
    finalUrl: "",
    acquisitionScope,
    collectedRaw: stats.leadsFound,
    collectedUnique,
    classifiedHackathon:
      result?.metrics?.classifiedHackathon ??
      warningNumber(warnings, "classified_hackathon") ??
      (stats.source === "devpost" ? collectedUnique : 0),
    themeRelevant:
      result?.metrics?.contentThemeMatched ??
      result?.metrics?.themeRelevant ??
      warningNumber(warnings, "content_theme_matched") ??
      warningNumber(warnings, "theme_relevant") ??
      0,
    feedThemeCandidate:
      result?.metrics?.feedThemeCandidate ??
      warningNumber(warnings, "feed_theme_candidate") ??
      0,
    contentThemeMatched:
      result?.metrics?.contentThemeMatched ??
      warningNumber(warnings, "content_theme_matched") ??
      result?.metrics?.themeRelevant ??
      warningNumber(warnings, "theme_relevant") ??
      0,
    // Pipeline accepted is authoritative final query-relevant; collector may emit an estimate.
    queryRelevant:
      stats.accepted > 0
        ? stats.accepted
        : (result?.metrics?.queryRelevant ??
          warningNumber(warnings, "query_relevant_estimate") ??
          stats.accepted),
    enriched,
    queueReady: stats.queueReady,
    needsReview: stats.needsReview,
    rejected: stats.rejected,
    pagesOrScrolls,
    actions:
      typeof result?.metrics?.detailPagesOpened === "number" ? result.metrics.detailPagesOpened : 0,
    stopReason: clip(String(stopReason), SOURCE_TELEMETRY_REASON_MAX),
    stopEvidence: clip(stopEvidence, SOURCE_TELEMETRY_REASON_MAX),
    sourceState: outcomeToSourceState(stats.outcome),
    listingDurationMs,
    detailDurationMs,
    totalDurationMs: stats.durationMs,
  };
  if (typeof directoryReportedTotal === "number" && directoryReportedTotal > 0) {
    telemetry.directoryReportedTotal = directoryReportedTotal;
  }
  if (typeof targetForProfile === "number") {
    telemetry.targetForProfile = targetForProfile;
  }
  if (typeof targetReached === "boolean") {
    telemetry.targetReached = targetReached;
  }

  if (result) {
    const inventory = inferInventoryEstimate(stats.source, result);
    if (inventory) telemetry.observedDirectoryInventory = inventory;
    if (result.errors[0]) {
      telemetry.failureClassification = clip(result.errors[0], SOURCE_TELEMETRY_REASON_MAX);
    }
  }

  return clampSourceTelemetry(telemetry);
}

export function clampSourceTelemetry(telemetry: SourceRunTelemetry): SourceRunTelemetry {
  const next: SourceRunTelemetry = {
    ...telemetry,
    acquisitionScope: clip(telemetry.acquisitionScope, SOURCE_TELEMETRY_REASON_MAX),
    requestedUrl: clip(telemetry.requestedUrl, SOURCE_TELEMETRY_URL_MAX),
    finalUrl: clip(telemetry.finalUrl, SOURCE_TELEMETRY_URL_MAX),
    stopReason: clip(telemetry.stopReason, SOURCE_TELEMETRY_REASON_MAX),
    stopEvidence: clip(telemetry.stopEvidence, SOURCE_TELEMETRY_REASON_MAX),
    sourceState: clip(telemetry.sourceState, SOURCE_TELEMETRY_REASON_MAX),
    ...(telemetry.failureClassification
      ? { failureClassification: clip(telemetry.failureClassification, SOURCE_TELEMETRY_REASON_MAX) }
      : {}),
  };
  if (next.observedDirectoryInventory) {
    next.observedDirectoryInventory = {
      value: Math.max(0, Math.floor(next.observedDirectoryInventory.value)),
      method: next.observedDirectoryInventory.method,
      confidence: next.observedDirectoryInventory.confidence,
    };
  }
  let json = JSON.stringify(next);
  if (byteLength(json) <= SOURCE_TELEMETRY_MAX_ITEM_BYTES) return next;

  delete next.failureClassification;
  json = JSON.stringify(next);
  if (byteLength(json) <= SOURCE_TELEMETRY_MAX_ITEM_BYTES) return next;
  next.requestedUrl = "";
  next.finalUrl = "";
  json = JSON.stringify(next);
  if (byteLength(json) <= SOURCE_TELEMETRY_MAX_ITEM_BYTES) return next;
  delete next.observedDirectoryInventory;
  return next;
}

export function compactSourceTelemetryArray(
  items: SourceRunTelemetry[],
): SourceRunTelemetry[] {
  const out: SourceRunTelemetry[] = [];
  let total = 2; // []
  for (const item of items) {
    const clamped = clampSourceTelemetry(item);
    const size = byteLength(JSON.stringify(clamped)) + (out.length > 0 ? 1 : 0);
    if (total + size > SOURCE_TELEMETRY_MAX_ARRAY_BYTES) break;
    out.push(clamped);
    total += size;
  }
  return out;
}

/** Compact source row for job summary — omits warning/error dumps. */
export function compactSourceStatsForSummary(
  stats: SourceRunStats[],
): Array<Record<string, unknown>> {
  return stats.map((row) => {
    const telemetry = row.telemetry;
    return {
      source: row.source,
      leadsFound: row.leadsFound,
      queueReady: row.queueReady,
      needsReview: row.needsReview,
      rejected: row.rejected,
      invalidRejected: row.invalidRejected,
      accepted: row.accepted,
      durationMs: row.durationMs,
      outcome: row.outcome,
      acquisitionScope: telemetry?.acquisitionScope ?? null,
      stopReason: telemetry?.stopReason ?? row.outcome,
      stopEvidence: telemetry?.stopEvidence ?? null,
      collectedRaw: telemetry?.collectedRaw ?? row.leadsFound,
      collectedUnique: telemetry?.collectedUnique ?? row.leadsFound,
      directoryReportedTotal: telemetry?.directoryReportedTotal ?? null,
      targetForProfile: telemetry?.targetForProfile ?? null,
      targetReached: telemetry?.targetReached ?? null,
      classifiedHackathon: telemetry?.classifiedHackathon ?? null,
      feedThemeCandidate: telemetry?.feedThemeCandidate ?? null,
      contentThemeMatched: telemetry?.contentThemeMatched ?? null,
      themeRelevant: telemetry?.themeRelevant ?? null,
      queryRelevant: telemetry?.queryRelevant ?? row.accepted,
      observedDirectoryInventory: telemetry?.observedDirectoryInventory ?? null,
      mechanism: telemetry?.mechanism ?? null,
      pagesOrScrolls: telemetry?.pagesOrScrolls ?? null,
      sourceState: telemetry?.sourceState ?? row.outcome,
      listingDurationMs: telemetry?.listingDurationMs ?? null,
      detailDurationMs: telemetry?.detailDurationMs ?? null,
    };
  });
}

/** Legacy-shaped sourceStats (warnings/errors included) for payload before/after sizing. */
export function legacySourceStatsPayload(stats: SourceRunStats[]): Array<Record<string, unknown>> {
  return stats.map((row) => ({
    source: row.source,
    leadsFound: row.leadsFound,
    queueReady: row.queueReady,
    needsReview: row.needsReview,
    rejected: row.rejected,
    invalidRejected: row.invalidRejected,
    accepted: row.accepted,
    durationMs: row.durationMs,
    outcome: row.outcome,
    warnings: row.warnings,
    errors: row.errors,
  }));
}

export function estimateJsonBytes(value: unknown): number {
  return byteLength(JSON.stringify(value));
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
