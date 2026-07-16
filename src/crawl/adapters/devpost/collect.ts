import {
  DevpostDirectoryAdapter,
  leadsFromDevpostSession,
  mapDevpostKernelStopReason,
  type DevpostAcquisitionScope,
  type DevpostApiPageSnapshot,
  type DevpostDirectorySession,
  type DevpostFetchPage,
} from "@/crawl/adapters/devpost/adapter";
import { crawlDirectory } from "@/crawl/kernel";
import type { CompactCrawlProgressEvent, CrawlBudget } from "@/crawl/types";
import type { RawLead } from "@/core/discovery/types";

export type CollectDevpostViaKernelInput = {
  maxResults: number;
  maxPages: number;
  timeoutMs: number;
  scope?: DevpostAcquisitionScope;
  targetCards?: number;
  stopAtTarget?: boolean;
  fetchPage: DevpostFetchPage;
  classifyOpenState: DevpostDirectorySession["classifyOpenState"];
  buildApiUrl: (page: number, scope: DevpostAcquisitionScope) => string;
  stopEvidence: (stopReason: string, metaTotalCount: number | null, targetCards?: number) => string;
  logger?: (message: string) => void;
  signal?: AbortSignal;
  onProgress?: (event: CompactCrawlProgressEvent) => void;
};

export type CollectDevpostViaKernelResult = {
  leads: RawLead[];
  pages: DevpostApiPageSnapshot[];
  duplicateUrls: number;
  repeatedPages: number;
  stopReason: string;
  stopEvidence: string;
  acquisitionScope: DevpostAcquisitionScope;
  metaTotalCount: number | null;
  statusCounts: Record<string, number>;
  listingDurationMs: number;
  targetReached: boolean;
  sourceState: string;
  kernelStopReason: string;
  pagesOrScrolls: number;
  requests: number;
  progressEvents: CompactCrawlProgressEvent[];
};

export async function collectDevpostViaKernel(
  input: CollectDevpostViaKernelInput,
): Promise<CollectDevpostViaKernelResult> {
  const scope = input.scope ?? "full_directory_api";
  const targetCards = Math.max(1, input.targetCards ?? input.maxResults);
  const stopAtTarget = Boolean(input.stopAtTarget);
  const collectLimit = stopAtTarget ? Math.min(targetCards, input.maxResults) : input.maxResults;

  const budget: CrawlBudget = {
    maxDurationMs: input.timeoutMs,
    maxRequests: Math.max(input.maxPages, 1),
    maxPagesOrScrolls: Math.max(input.maxPages, 1),
    // API pagination does not use browser actions; keep this high so 0-used never trips exhaustion.
    maxBrowserActions: Math.max(input.maxPages * 4, 32),
    maxPayloadBytes: 20_000_000,
    targetUnique: targetCards,
    stopAtTarget,
    maxUnique: collectLimit,
  };

  const adapter = new DevpostDirectoryAdapter({
    scope,
    maxPages: input.maxPages,
    timeoutMs: input.timeoutMs,
    fetchPage: input.fetchPage,
    classifyOpenState: input.classifyOpenState,
    logger: input.logger,
  });

  const progressEvents: CompactCrawlProgressEvent[] = [];

  const result = await crawlDirectory({
    adapter,
    url: input.buildApiUrl(1, scope),
    budget,
    signal: input.signal,
    onProgress: (event) => {
      progressEvents.push(event);
      input.onProgress?.(event);
    },
  });

  const activeSession = adapter.lastSession;
  if (activeSession && typeof activeSession.metaTotalCount === "number") {
    result.inventory.observed = {
      value: activeSession.metaTotalCount,
      method: "api_total",
      confidence: "strong",
    };
  }
  const leads = leadsFromDevpostSession(activeSession, result.cards);
  const stopReason = mapDevpostKernelStopReason(
    result.stopReason,
    activeSession?.adapterStopDetail,
  );
  const metaTotalCount = activeSession?.metaTotalCount ?? null;

  return {
    leads,
    pages: activeSession?.pages ?? [],
    duplicateUrls: activeSession?.duplicateUrls ?? 0,
    repeatedPages: activeSession?.repeatedPages ?? 0,
    stopReason,
    stopEvidence: input.stopEvidence(stopReason, metaTotalCount, targetCards),
    acquisitionScope: scope,
    metaTotalCount,
    statusCounts: activeSession?.statusCounts ?? {
      open: 0,
      upcoming: 0,
      ended: 0,
      unknown: 0,
    },
    listingDurationMs: result.listingDurationMs,
    targetReached: result.targetReached,
    sourceState: result.sourceState,
    kernelStopReason: result.stopReason,
    pagesOrScrolls: result.pagesOrScrolls,
    requests: result.requests,
    progressEvents,
  };
}
