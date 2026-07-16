import { emptyCollectorResult, type CollectorResult } from "@/collectors/types";
import {
  CustomDirectoryAdapter,
  persistSuccessfulCrawlPlan,
  type CustomAdapterSource,
  type CustomDirectorySession,
} from "@/crawl/adapters/custom/adapter";
import type { CardExtractionDiagnostics } from "@/crawl/adapters/custom/extractCards";
import type { GenericShadowLead } from "@/crawl/adapters/custom/generic/types";
import { stableDedupeKey } from "@/crawl/adapters/custom/generic/valueUtils";
import { isBlockedCustomSourceUrl } from "@/crawl/adapters/custom/origins";
import { crawlDirectory } from "@/crawl/kernel";
import type { CrawlBudget, DirectoryCrawlResult, ListingCard } from "@/crawl/types";
import type { DiscoverySourceId, RawLead } from "@/core/discovery/types";
import { slugify, uniqueUrls } from "@/lib/http/url";
import type { CustomSource } from "@/server/customSources/types";
import { updateCustomSourceHealth } from "@/server/customSources/repository";

const TELEMETRY_SOURCE_MAX_BYTES = 2_048;

function customSourceId(source: CustomSource): DiscoverySourceId {
  return `custom:${source.slug}` as DiscoverySourceId;
}

function toAdapterSource(source: CustomSource): CustomAdapterSource {
  return {
    slug: source.slug,
    listingUrl: source.listingUrl,
    mode: source.mode,
    maxItems: source.maxItems,
    browserAllowed: source.mode !== "static",
  };
}

function budgetForSource(source: CustomSource): CrawlBudget {
  const isHackathonsSpace = /hackathons\.space/i.test(source.listingUrl);
  return {
    maxDurationMs: 180_000,
    maxRequests: Math.max(8, Math.min(40, source.maxItems)),
    maxPagesOrScrolls: isHackathonsSpace
      ? 3
      : Math.max(3, Math.min(20, Math.ceil(source.maxItems / 10))),
    maxBrowserActions: isHackathonsSpace ? 3 : 8,
    maxPayloadBytes: 5_000_000,
    maxUnique: source.maxItems,
  };
}

export function listingCardToRawLead(source: CustomSource, card: ListingCard): RawLead {
  const sourceId = customSourceId(source);
  const url = card.url ?? source.listingUrl;
  const key = slugify(`${source.slug}-${card.identity || card.title}-${url}`);
  return {
    id: `custom-${source.slug}-${key}`,
    source: sourceId,
    title: card.title,
    url,
    text: card.evidence?.shortDescription ?? card.title,
    links: uniqueUrls([url, source.listingUrl], source.listingUrl),
    postedAt: new Date().toISOString(),
    metadata: {
      attribution: sourceId,
      provenance: "custom_site_kernel",
      discoveryMode: "custom_directory_kernel",
      listingUrl: source.listingUrl,
      officialUrl: url,
      applyUrl: url,
      startDate: card.startDate,
      endDate: card.endDate,
      applicationDeadline: card.deadline,
      deadline: card.deadline,
      status: card.evidence?.statusText,
      location: card.evidence?.locationText,
      format: card.modeHint,
      sourceIds: { [sourceId]: key },
    },
  };
}

export function genericLeadToRawLead(source: CustomSource, lead: GenericShadowLead): RawLead {
  const sourceId = customSourceId(source);
  const url = lead.canonicalUrl ?? lead.sourceUrl;
  const key = slugify(
    `${source.slug}-${stableDedupeKey([lead.sourceRecordId, lead.canonicalUrl, lead.title])}-${url}`,
  );
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
      provenance: "custom_site_kernel",
      discoveryMode: "custom_directory_kernel",
      listingUrl: source.listingUrl,
      officialUrl: url,
      applyUrl: url,
      startDate: lead.startDate,
      endDate: lead.endDate,
      applicationDeadline: lead.deadline,
      deadline: lead.deadline,
      status: lead.normalizedStatus !== "unknown" ? lead.normalizedStatus : undefined,
      location: lead.location,
      format: lead.mode,
      sourceIds: { [sourceId]: key },
    },
  };
}

function blockedResult(source: CustomSource, startedAt: number): CollectorResult {
  const result = emptyCollectorResult(customSourceId(source), startedAt);
  result.status = "failed";
  result.warnings.push("blocked_human_verification");
  result.errors.push("Source blocked by human verification / WAF. No bypass attempted.");
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

function clampTelemetry(value: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(value);
  if (byteLength(json) <= TELEMETRY_SOURCE_MAX_BYTES) return value;
  return {
    truncated: true,
    sourceState: value.sourceState,
    stopReason: value.stopReason,
    unique: value.normalizedUniqueCards,
    mechanism: value.mechanism,
  };
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function buildTelemetry(input: {
  crawl: DirectoryCrawlResult;
  extraction?: CardExtractionDiagnostics;
  planCacheStatus: string;
  queryRelevant?: number;
  queueReady?: number;
  needsReview?: number;
  rejected?: number;
}): Record<string, unknown> {
  return clampTelemetry({
    acquisitionScope: "custom_directory",
    mechanism: input.crawl.mechanism,
    requestedUrl: input.crawl.requestedUrl,
    finalUrl: input.crawl.finalUrl,
    inventoryEstimate: input.crawl.inventory.observed,
    rawObservations: input.crawl.inventory.collectedRaw,
    normalizedUniqueCards: input.crawl.inventory.collectedUnique,
    duplicateCount: Math.max(
      0,
      input.crawl.inventory.collectedRaw - input.crawl.inventory.collectedUnique,
    ),
    pagesOrScrolls: input.crawl.pagesOrScrolls,
    actions: input.crawl.actions,
    deterministicExtraction: input.extraction?.deterministicOk ?? false,
    aiSelectionUsed: input.extraction?.aiSelectionUsed ?? false,
    aiUnavailable: input.extraction?.aiUnavailable ?? false,
    queryRelevant: input.queryRelevant,
    queueReady: input.queueReady,
    needsReview: input.needsReview,
    rejected: input.rejected,
    listingDurationMs: input.crawl.listingDurationMs,
    stopReason: input.crawl.stopReason,
    stopEvidence: input.crawl.stopReason,
    sourceState: input.crawl.sourceState,
    crawlPlanCache: input.planCacheStatus,
    adapterId: input.crawl.adapterId,
    adapterVersion: input.crawl.adapterVersion,
    kernelVersion: input.crawl.kernelVersion,
  });
}

function mapSourceStateToCollectorStatus(
  crawl: DirectoryCrawlResult,
  extraction?: CardExtractionDiagnostics,
): CollectorResult["status"] {
  if (
    crawl.sourceState === "blocked_human_verification" ||
    crawl.stopReason === "blocked_human_verification"
  ) {
    return "failed";
  }
  if (crawl.sourceState === "blocked_authentication") return "auth_required";
  if (crawl.sourceState === "acquisition_failed" || crawl.cards.length === 0) {
    if (extraction?.aiUnavailable) return "degraded";
    return crawl.cards.length === 0 ? "failed" : "degraded";
  }
  if (crawl.sourceState === "degraded" || crawl.sourceState === "usable_partial") return "degraded";
  return "completed";
}

/**
 * Collect a custom source through the shared DirectoryCrawlKernel.
 * Never imports the experiment adaptive/Crawlee runtime.
 */
export async function collectCustomSourceViaKernel(
  source: CustomSource,
  options: {
    timeoutMs?: number;
    logger?: (message: string) => void;
    persistHealth?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<CollectorResult> {
  const startedAt = Date.now();
  const customId = customSourceId(source);

  if (isBlockedCustomSourceUrl(source.listingUrl)) {
    options.logger?.(
      `[${customId}] blocked_human_verification — stopping without bypass`,
    );
    return blockedResult(source, startedAt);
  }

  options.logger?.(`[${customId}] custom kernel crawl starting`);
  const adapter = new CustomDirectoryAdapter(toAdapterSource(source));
  let sessionRef: CustomDirectorySession | undefined;

  const crawl = await crawlDirectory({
    adapter: {
      id: adapter.id,
      version: adapter.version,
      acquire: async (acquireInput) => {
        const acquired = await adapter.acquire(acquireInput);
        sessionRef = acquired.session;
        return acquired;
      },
      grow: (growInput) => adapter.grow(growInput),
      release: (session) => adapter.release(session),
    },
    url: source.listingUrl,
    budget: budgetForSource(source),
    signal: options.signal,
  });

  if (
    crawl.stopReason === "blocked_human_verification" ||
    sessionRef?.blockedReason === "blocked_human_verification"
  ) {
    options.logger?.(`[${customId}] blocked_human_verification — zero leads`);
    return blockedResult(source, startedAt);
  }

  const result = emptyCollectorResult(customId, startedAt);
  result.leads = crawl.cards
    .slice(0, source.maxItems)
    .map((card) => listingCardToRawLead(source, card))
    .filter((lead) => {
      const title = (lead.title ?? "").trim();
      return !/^(learn more|hackathons?|blog|the garden|host a hackathon|consultancy(?: plan)?|about|home|login|sign in|menu)$/i.test(
        title,
      );
    });
  result.status = mapSourceStateToCollectorStatus(crawl, sessionRef?.extraction);
  result.diagnostics = {
    discovered: crawl.inventory.collectedRaw,
    returned: result.leads.length,
    enriched: 0,
    partial: 0,
    dropped: Math.max(0, crawl.inventory.collectedRaw - result.leads.length),
    pagesTraversed: crawl.pagesOrScrolls,
    extractionStrategy: sessionRef?.extraction?.strategy ?? "custom_directory_kernel",
    stopReason: crawl.stopReason,
    safeMessage: crawl.sourceState,
  };

  if (sessionRef?.extraction?.aiUnavailable) {
    result.warnings.push("ai_unavailable");
    if (result.leads.length === 0) {
      result.status = "degraded";
      result.diagnostics.safeMessage = "ai_unavailable";
      result.diagnostics.stopReason = "acquisition_failed";
    }
  }
  result.warnings.push(
    `custom_runtime=kernel`,
    `source_state=${crawl.sourceState}`,
    `mechanism=${crawl.mechanism}`,
  );
  if (/eventornado/i.test(source.listingUrl)) {
    // Dynamic site: never claim full complete from a single bounded pass.
    if (crawl.sourceState === "healthy_complete" || crawl.sourceState === "healthy_bounded") {
      result.warnings.push("eventornado_coverage=partial — dynamic coverage not fully proven");
      result.status = "degraded";
      result.diagnostics.safeMessage = "usable_partial";
    } else if (crawl.sourceState === "usable_partial") {
      result.warnings.push("eventornado_coverage=partial — dynamic coverage not fully proven");
    }
  }

  const telemetry = buildTelemetry({
    crawl,
    extraction: sessionRef?.extraction,
    planCacheStatus: sessionRef?.planCacheStatus ?? "absent",
  });
  result.metrics = {
    kernelUnique: crawl.inventory.collectedUnique,
    kernelPages: crawl.pagesOrScrolls,
    kernelActions: crawl.actions,
    kernelWrites: result.leads.length,
    ...(sessionRef?.extraction?.aiSelectionUsed ? { aiSelectionUsed: 1 } : { aiSelectionUsed: 0 }),
    ...(sessionRef?.extraction?.aiInvoked ? { aiInvoked: 1 } : { aiInvoked: 0 }),
    ...(sessionRef?.extraction?.aiUnavailable ? { aiUnavailable: 1 } : {}),
    ...(sessionRef?.extraction?.validEventLeads
      ? { validEventLeads: sessionRef.extraction.validEventLeads }
      : {}),
  };
  result.warnings.push(`telemetry_bytes=${byteLength(JSON.stringify(telemetry))}`);

  const usable =
    result.leads.length > 0 &&
    (crawl.sourceState === "healthy_complete" ||
      crawl.sourceState === "healthy_bounded" ||
      crawl.sourceState === "usable_partial");

  if (sessionRef) {
    await persistSuccessfulCrawlPlan({
      session: sessionRef,
      sourceState: crawl.sourceState,
      uniqueCards: crawl.inventory.collectedUnique,
      usable,
    });
  }

  if (options.persistHealth) {
    await updateCustomSourceHealth(source.slug, {
      status: usable ? "healthy" : result.status === "failed" ? "failed" : "degraded",
      checkedAt: new Date().toISOString(),
      lastErrorSafe:
        result.status === "failed"
          ? crawl.stopReason.slice(0, 200)
          : null,
    }).catch(() => undefined);
  }

  result.durationMs = Date.now() - startedAt;
  options.logger?.(
    `[${customId}] kernel ${result.leads.length} leads; state=${crawl.sourceState}; stop=${crawl.stopReason}`,
  );
  return result;
}
