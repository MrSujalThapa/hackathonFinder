import type { DiscoverySourceId, RawLead } from "@/core/discovery/types";
import { emptyCollectorResult, type CollectorResult } from "@/collectors/types";
import { collectCustomSource } from "@/collectors/customSource";
import type {
  GenericShadowLead,
  GenericStructuredExtractionResult,
  SourceExperiment,
} from "@/experiments/scraper-v2/generic/types";
import type { CustomSource } from "@/server/customSources/types";
import { slugify, uniqueUrls } from "@/lib/http/url";

async function loadGenericStructuredExtraction() {
  // Dynamic import keeps Crawlee/Puppeteer out of the default Next.js server graph
  // when GENERIC_SCRAPER_V2_MODE=off.
  const mod = await import("@/experiments/scraper-v2/generic/structuredExtraction");
  return mod.runGenericStructuredExtraction;
}

export type GenericScraperV2Mode = "off" | "shadow" | "live";

const BLOCKED_HOSTS = [/dorahacks\.io$/i];

export function readGenericScraperV2Mode(
  env: NodeJS.ProcessEnv = process.env,
): GenericScraperV2Mode {
  const raw = (env.GENERIC_SCRAPER_V2_MODE ?? "off").trim().toLowerCase();
  if (raw === "shadow" || raw === "live" || raw === "off") return raw;
  return "off";
}

export function isBlockedCustomSourceUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    return BLOCKED_HOSTS.some((pattern) => pattern.test(host));
  } catch {
    return false;
  }
}

export function customSourceToExperiment(source: CustomSource): SourceExperiment {
  let origin = source.listingUrl;
  try {
    origin = new URL(source.listingUrl).origin;
  } catch {
    // keep listing URL
  }
  return {
    inputUrl: source.listingUrl,
    allowedOrigins: [origin],
    maxRequests: Math.max(8, Math.min(40, source.maxItems)),
    maxPages: Math.max(3, Math.min(20, Math.ceil(source.maxItems / 10))),
    maxBrowserActions: 8,
    maxPayloadBytes: 2_000_000,
    browserAllowed: source.mode !== "static",
    expectedContentCategory: "public_event_directory",
    expectedMinimumEventCount:
      /hackathons\.space/i.test(source.listingUrl) ? 20 : undefined,
  };
}

export function genericLeadToRawLead(
  source: CustomSource,
  lead: GenericShadowLead,
): RawLead {
  const sourceId = `custom:${source.slug}` as const;
  const url = lead.canonicalUrl ?? lead.sourceUrl;
  const key = slugify(`${source.slug}-${lead.sourceRecordId ?? lead.title}-${url}`);
  return {
    id: `custom-${source.slug}-${key}`,
    source: sourceId,
    title: lead.title,
    url,
    text: lead.description ?? lead.title,
    links: uniqueUrls([url, source.listingUrl], source.listingUrl),
    postedAt: new Date().toISOString(),
    metadata: {
      attribution: sourceId,
      provenance: "custom_site_v2",
      discoveryMode: "generic_scraper_v2",
      listingUrl: source.listingUrl,
      officialUrl: url,
      applyUrl: url,
      startDate: lead.startDate,
      endDate: lead.endDate,
      applicationDeadline: lead.deadline,
      location: lead.location,
      format: lead.mode,
      genericV2Status: lead.normalizedStatus,
      genericV2Confidence: lead.confidence,
      sourceIds: { [sourceId]: key },
    },
  };
}

function customSourceId(source: CustomSource): DiscoverySourceId {
  return `custom:${source.slug}` as DiscoverySourceId;
}

function blockedResult(source: CustomSource, startedAt: number): CollectorResult {
  const result = emptyCollectorResult(customSourceId(source), startedAt);
  result.status = "failed";
  result.warnings.push("blocked_human_verification");
  result.errors.push(
    "Source blocked by human verification / WAF. No bypass attempted.",
  );
  result.diagnostics = {
    discovered: 0,
    returned: 0,
    enriched: 0,
    partial: 0,
    dropped: 0,
    stopReason: "blocked_human_verification",
    safeMessage: "blocked_human_verification",
  };
  return result;
}

function shadowMetrics(
  extraction: GenericStructuredExtractionResult,
): Record<string, number> {
  return {
    v2Discovered: extraction.quality.discoveredRecords,
    v2Normalized: extraction.quality.normalizedLeads,
    v2Valid: extraction.quality.validEventLeads,
    v2Pages: extraction.pagination.pageCount,
  };
}

/**
 * Collect a configured custom source through production V1 and/or guarded Generic V2.
 * - off: existing custom collector only
 * - shadow: run V2 for metrics, write nothing from V2
 * - live: prefer validated V2 leads in the normal pipeline
 */
export async function collectCustomSourceWithV2Routing(
  source: CustomSource,
  options: {
    mode?: GenericScraperV2Mode;
    timeoutMs?: number;
    logger?: (message: string) => void;
    persistHealth?: boolean;
  } = {},
): Promise<CollectorResult> {
  const startedAt = Date.now();
  const mode = options.mode ?? readGenericScraperV2Mode();
  const customId = customSourceId(source);

  if (isBlockedCustomSourceUrl(source.listingUrl)) {
    options.logger?.(
      `[${customId}] blocked_human_verification — stopping without bypass`,
    );
    return blockedResult(source, startedAt);
  }

  if (mode === "off") {
    return collectCustomSource(source, {
      timeoutMs: options.timeoutMs,
      logger: options.logger,
      persistHealth: options.persistHealth,
    });
  }

  options.logger?.(`[${customId}] Generic V2 mode=${mode}`);
  const experiment = customSourceToExperiment(source);
  let extraction: GenericStructuredExtractionResult | undefined;
  try {
    const runGenericStructuredExtraction = await loadGenericStructuredExtraction();
    extraction = await runGenericStructuredExtraction(experiment);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generic V2 failed";
    options.logger?.(`[${customId}] Generic V2 error: ${message}`);
    if (mode === "live") {
      options.logger?.(`[${customId}] Falling back to production custom collector`);
      return collectCustomSource(source, {
        timeoutMs: options.timeoutMs,
        logger: options.logger,
        persistHealth: options.persistHealth,
      });
    }
    const shadow = emptyCollectorResult(customId, startedAt);
    shadow.status = "degraded";
    shadow.warnings.push(`generic_v2_shadow_error=${message}`);
    // Shadow never writes V2 leads.
    const v1 = await collectCustomSource(source, {
      timeoutMs: options.timeoutMs,
      logger: options.logger,
      persistHealth: options.persistHealth,
    });
    v1.warnings.push(...shadow.warnings, "generic_v2_mode=shadow", "generic_v2_writes=0");
    return v1;
  }

  if (extraction.quality.classification === "blocked_human_verification") {
    options.logger?.(
      `[${customId}] blocked_human_verification — stopping without bypass`,
    );
    return blockedResult(source, startedAt);
  }

  const v2Leads = extraction.leads.map((lead) => genericLeadToRawLead(source, lead));
  options.logger?.(
    `[${customId}] V2 ${extraction.quality.validEventLeads}/${extraction.quality.normalizedLeads} valid/normalized; class=${extraction.quality.classification}`,
  );

  if (mode === "shadow") {
    const v1 = await collectCustomSource(source, {
      timeoutMs: options.timeoutMs,
      logger: options.logger,
      persistHealth: options.persistHealth,
    });
    v1.warnings.push(
      "generic_v2_mode=shadow",
      "generic_v2_writes=0",
      `generic_v2_classification=${extraction.quality.classification}`,
      `generic_v2_valid=${extraction.quality.validEventLeads}`,
      `generic_v2_pages=${extraction.pagination.pageCount}`,
    );
    v1.metrics = {
      ...(v1.metrics ?? {}),
      ...shadowMetrics(extraction),
      genericV2Writes: 0,
    };
    return v1;
  }

  // live mode — feed V2 leads through the normal pipeline path
  const result = emptyCollectorResult(customId, startedAt);
  const usable =
    extraction.quality.classification === "healthy_complete" ||
    extraction.quality.classification === "healthy_bounded" ||
    extraction.quality.classification === "usable_partial" ||
    extraction.quality.classification === "degraded_under_extraction";

  if (!usable || v2Leads.length === 0) {
    options.logger?.(
      `[${customId}] V2 not live-usable (${extraction.quality.classification}); using production collector`,
    );
    const v1 = await collectCustomSource(source, {
      timeoutMs: options.timeoutMs,
      logger: options.logger,
      persistHealth: options.persistHealth,
    });
    v1.warnings.push(
      "generic_v2_mode=live",
      `generic_v2_classification=${extraction.quality.classification}`,
      "generic_v2_fallback=production",
    );
    return v1;
  }

  result.leads = v2Leads.slice(0, source.maxItems);
  result.status =
    extraction.quality.classification.startsWith("degraded") ||
    extraction.quality.classification === "usable_partial"
      ? "degraded"
      : "completed";
  result.warnings.push(
    "generic_v2_mode=live",
    `generic_v2_classification=${extraction.quality.classification}`,
  );
  if (/eventornado/i.test(source.listingUrl)) {
    result.warnings.push(
      "eventornado_coverage=partial — dynamic coverage not fully proven",
    );
  }
  result.diagnostics = {
    discovered: extraction.quality.discoveredRecords,
    returned: result.leads.length,
    enriched: 0,
    partial: Math.max(0, extraction.quality.normalizedLeads - extraction.quality.validEventLeads),
    dropped: Math.max(0, extraction.quality.discoveredRecords - result.leads.length),
    pagesTraversed: extraction.pagination.pageCount,
    extractionStrategy: "generic_scraper_v2",
    stopReason: extraction.pagination.stopReason,
    safeMessage: extraction.quality.classification,
  };
  result.metrics = {
    ...shadowMetrics(extraction),
    genericV2Writes: result.leads.length,
  };
  result.durationMs = Date.now() - startedAt;
  return result;
}
