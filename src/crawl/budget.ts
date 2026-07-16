import type { CrawlBudget } from "@/crawl/types";

export function emptyBudgetUsage(): {
  requests: number;
  pagesOrScrolls: number;
  actions: number;
  payloadBytes: number;
} {
  return { requests: 0, pagesOrScrolls: 0, actions: 0, payloadBytes: 0 };
}

export function remainingBudget(
  budget: CrawlBudget,
  used: {
    requests: number;
    pagesOrScrolls: number;
    actions: number;
    payloadBytes: number;
    elapsedMs: number;
    unique: number;
  },
): CrawlBudget {
  return {
    ...budget,
    maxDurationMs: Math.max(0, budget.maxDurationMs - used.elapsedMs),
    maxRequests: Math.max(0, budget.maxRequests - used.requests),
    maxPagesOrScrolls: Math.max(0, budget.maxPagesOrScrolls - used.pagesOrScrolls),
    maxBrowserActions: Math.max(0, budget.maxBrowserActions - used.actions),
    maxPayloadBytes: Math.max(0, budget.maxPayloadBytes - used.payloadBytes),
    maxUnique:
      typeof budget.maxUnique === "number"
        ? Math.max(0, budget.maxUnique - used.unique)
        : budget.maxUnique,
    targetUnique: budget.targetUnique,
    stopAtTarget: budget.stopAtTarget,
  };
}

export function isBudgetExhausted(
  budget: CrawlBudget,
  used: {
    requests: number;
    pagesOrScrolls: number;
    actions: number;
    payloadBytes: number;
    elapsedMs: number;
  },
): boolean {
  if (used.elapsedMs >= budget.maxDurationMs) return true;
  if (used.requests >= budget.maxRequests) return true;
  if (used.pagesOrScrolls >= budget.maxPagesOrScrolls) return true;
  if (used.actions >= budget.maxBrowserActions) return true;
  if (used.payloadBytes >= budget.maxPayloadBytes) return true;
  return false;
}

export function uniqueCap(budget: CrawlBudget): number | undefined {
  if (budget.stopAtTarget && typeof budget.targetUnique === "number") {
    return Math.min(budget.targetUnique, budget.maxUnique ?? budget.targetUnique);
  }
  return budget.maxUnique;
}
