/**
 * Browser-facing re-export — implementation lives in src/crawl (B1 move).
 * Do not reintroduce a second growth loop here.
 */
export {
  collectUntilStable,
  type CollectUntilStableOptions,
  type CollectUntilStableResult,
  type StableScrollStopReason,
} from "@/crawl/growth/collectUntilStable";
