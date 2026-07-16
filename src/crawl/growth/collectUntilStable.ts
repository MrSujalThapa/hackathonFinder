import type { StableScrollStopReason } from "@/crawl/stopReasons";

export type { StableScrollStopReason };

export type CollectUntilStableResult<T> = {
  items: T[];
  uniqueCount: number;
  scrollAttempts: number;
  noGrowthAttempts: number;
  stopReason: StableScrollStopReason;
  growthByAttempt: number[];
};

export type CollectUntilStableOptions<T> = {
  collectItems: () => Promise<T[]>;
  getKey: (item: T) => string | undefined;
  scroll: () => Promise<void>;
  waitForIdle?: () => Promise<void>;
  maxItems: number;
  maxScrolls: number;
  noGrowthLimit: number;
  timeoutMs: number;
  waitMs: number;
  logger?: (message: string) => void;
  loadingMessage?: string;
  countMessage?: (count: number) => string;
  signal?: AbortSignal;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Crawl cancelled");
    error.name = "AbortError";
    throw error;
  }
}

/**
 * Proven scroll growth loop — moved from src/lib/browser (B1).
 * Callers keep importing via @/lib/browser/collectUntilStable re-export.
 */
export async function collectUntilStable<T>(
  options: CollectUntilStableOptions<T>,
): Promise<CollectUntilStableResult<T>> {
  const startedAt = Date.now();
  const byKey = new Map<string, T>();
  const growthByAttempt: number[] = [];

  const merge = async (): Promise<number> => {
    const before = byKey.size;
    const items = await options.collectItems();
    for (const item of items) {
      const key = options.getKey(item);
      if (!key || byKey.has(key)) continue;
      byKey.set(key, item);
    }
    return byKey.size - before;
  };

  throwIfAborted(options.signal);
  await merge();
  options.logger?.(options.countMessage?.(byKey.size) ?? `${byKey.size} unique items found`);

  let scrollAttempts = 0;
  let noGrowthAttempts = 0;
  let stopReason: StableScrollStopReason = "no_growth";

  while (scrollAttempts < options.maxScrolls && byKey.size < options.maxItems) {
    throwIfAborted(options.signal);
    if (Date.now() - startedAt > options.timeoutMs) {
      stopReason = "timeout";
      break;
    }

    scrollAttempts += 1;
    options.logger?.(options.loadingMessage ?? "Loading more...");
    await options.scroll();
    await sleep(options.waitMs);
    await options.waitForIdle?.();

    const growth = await merge();
    growthByAttempt.push(growth);

    if (growth > 0) {
      noGrowthAttempts = 0;
      options.logger?.(options.countMessage?.(byKey.size) ?? `${byKey.size} unique items found`);
    } else {
      noGrowthAttempts += 1;
      if (noGrowthAttempts >= options.noGrowthLimit) {
        stopReason = "no_growth";
        break;
      }
    }
  }

  if (byKey.size >= options.maxItems) stopReason = "max_items";
  else if (scrollAttempts >= options.maxScrolls && noGrowthAttempts < options.noGrowthLimit) {
    stopReason = "max_scrolls";
  }

  return {
    items: [...byKey.values()].slice(0, options.maxItems),
    uniqueCount: Math.min(byKey.size, options.maxItems),
    scrollAttempts,
    noGrowthAttempts,
    stopReason,
    growthByAttempt,
  };
}
