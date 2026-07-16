/**
 * Compatibility re-export — implementation lives in `@/crawl/growth/collectUntilStable`.
 * Prefer `@/crawl` in new code. No duplicated growth loop. Post-C caller migration candidate.
 */
export {
  collectUntilStable,
  type CollectUntilStableOptions,
  type CollectUntilStableResult,
  type StableScrollStopReason,
} from "@/crawl/growth/collectUntilStable";
