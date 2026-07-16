import type { CrawlSourceState, CrawlStopReason } from "@/crawl/types";

/** Stable scroll helper reasons (legacy collectUntilStable API). */
export type StableScrollStopReason =
  | "no_growth"
  | "max_items"
  | "max_scrolls"
  | "timeout";

/**
 * Map legacy scroll stop reasons onto canonical crawl stop reasons.
 * max_items → target_reached when stopAtTarget, else maximum_cards_reached.
 */
export function mapStableScrollStopReason(
  reason: StableScrollStopReason,
  options?: { stopAtTarget?: boolean },
): CrawlStopReason {
  switch (reason) {
    case "no_growth":
      return "no_growth";
    case "timeout":
      return "timeout";
    case "max_scrolls":
      return "max_budget";
    case "max_items":
      return options?.stopAtTarget ? "target_reached" : "maximum_cards_reached";
    default:
      return "no_growth";
  }
}

export function mapCrawlStopToStableScroll(
  reason: CrawlStopReason,
): StableScrollStopReason {
  switch (reason) {
    case "timeout":
      return "timeout";
    case "max_budget":
      return "max_scrolls";
    case "target_reached":
    case "maximum_cards_reached":
      return "max_items";
    case "no_growth":
    case "exhausted":
    default:
      return "no_growth";
  }
}

export function sourceStateForStopReason(stopReason: CrawlStopReason): CrawlSourceState {
  switch (stopReason) {
    case "exhausted":
    case "no_growth":
      return "healthy_complete";
    case "target_reached":
    case "maximum_cards_reached":
    case "max_budget":
      return "healthy_bounded";
    case "timeout":
    case "cancelled":
      return "usable_partial";
    case "blocked_human_verification":
      return "blocked_human_verification";
    case "blocked_authentication":
      return "blocked_authentication";
    case "acquisition_failed":
      return "acquisition_failed";
    default:
      return "degraded";
  }
}

export function classifyUniqueCapStop(input: {
  unique: number;
  targetUnique?: number;
  maxUnique?: number;
  stopAtTarget?: boolean;
}): CrawlStopReason | undefined {
  const { unique, targetUnique, maxUnique, stopAtTarget } = input;
  // Soft target first when stopAtTarget (product light/standard).
  if (stopAtTarget && typeof targetUnique === "number" && unique >= targetUnique) {
    return "target_reached";
  }
  if (typeof maxUnique === "number" && unique >= maxUnique) {
    return "maximum_cards_reached";
  }
  return undefined;
}
