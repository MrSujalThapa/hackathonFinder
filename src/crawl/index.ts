export { CRAWL_KERNEL_VERSION } from "@/crawl/types";
export type {
  CompactCrawlProgressEvent,
  CrawlBudget,
  CrawlMechanism,
  CrawlSourceState,
  CrawlStopReason,
  DirectoryAdapter,
  DirectoryCrawlResult,
  GrowthStepResult,
  InventoryEstimate,
  ListingCard,
  ListingEvidence,
  SourceInventoryMetrics,
} from "@/crawl/types";

export { crawlDirectory, type DirectoryCrawlInput } from "@/crawl/kernel";
export { IdentityAccumulator } from "@/crawl/identityAccumulator";
export {
  emptyBudgetUsage,
  isBudgetExhausted,
  remainingBudget,
  uniqueCap,
} from "@/crawl/budget";
export {
  classifyUniqueCapStop,
  mapCrawlStopToStableScroll,
  mapStableScrollStopReason,
  sourceStateForStopReason,
  type StableScrollStopReason,
} from "@/crawl/stopReasons";
export { clampProgressEvent, createProgressEvent, emitProgress } from "@/crawl/progress";
export {
  collectUntilStable,
  type CollectUntilStableOptions,
  type CollectUntilStableResult,
} from "@/crawl/growth/collectUntilStable";
