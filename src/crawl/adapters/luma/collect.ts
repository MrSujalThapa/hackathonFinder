import {
  LumaFeedAdapter,
  leadsFromLumaFeedSession,
  mapLumaKernelStopToStable,
  type LumaFeedGrowHooks,
} from "@/crawl/adapters/luma/adapter";
import { crawlDirectory } from "@/crawl/kernel";
import type { CompactCrawlProgressEvent, CrawlBudget } from "@/crawl/types";
import type { RawLead } from "@/core/discovery/types";

export type CollectLumaFeedViaKernelInput = {
  feedUrl: string;
  maxEvents: number;
  maxScrolls: number;
  timeoutMs: number;
  hooks: LumaFeedGrowHooks;
  signal?: AbortSignal;
  onProgress?: (event: CompactCrawlProgressEvent) => void;
};

export type CollectLumaFeedViaKernelResult = {
  leads: RawLead[];
  uniqueCount: number;
  scrollAttempts: number;
  noGrowthAttempts: number;
  stopReason: "no_growth" | "max_items" | "max_scrolls" | "timeout";
  kernelStopReason: string;
  sourceState: string;
  listingDurationMs: number;
  progressEvents: CompactCrawlProgressEvent[];
};

export async function collectLumaFeedViaKernel(
  input: CollectLumaFeedViaKernelInput,
): Promise<CollectLumaFeedViaKernelResult> {
  const budget: CrawlBudget = {
    maxDurationMs: input.timeoutMs,
    maxRequests: Math.max(input.maxScrolls + 2, 4),
    maxPagesOrScrolls: Math.max(input.maxScrolls, 1),
    maxBrowserActions: Math.max(input.maxScrolls, 1),
    maxPayloadBytes: 20_000_000,
    maxUnique: input.maxEvents,
    stopAtTarget: false,
  };

  const adapter = new LumaFeedAdapter({
    feedUrl: input.feedUrl,
    hooks: input.hooks,
  });

  const progressEvents: CompactCrawlProgressEvent[] = [];

  const result = await crawlDirectory({
    adapter,
    url: input.feedUrl,
    budget,
    signal: input.signal,
    onProgress: (event) => {
      progressEvents.push(event);
      input.onProgress?.(event);
    },
  });

  const activeSession = adapter.lastSession;
  const leads = leadsFromLumaFeedSession(activeSession, result.cards);

  return {
    leads,
    uniqueCount: leads.length,
    scrollAttempts: activeSession?.scrollAttempts ?? result.pagesOrScrolls,
    noGrowthAttempts: activeSession?.noGrowthAttempts ?? 0,
    stopReason: mapLumaKernelStopToStable(
      result.stopReason,
      activeSession?.adapterStopDetail,
    ),
    kernelStopReason: result.stopReason,
    sourceState: result.sourceState,
    listingDurationMs: result.listingDurationMs,
    progressEvents,
  };
}
