import { emptyBudgetUsage, isBudgetExhausted, remainingBudget, uniqueCap } from "@/crawl/budget";
import { IdentityAccumulator } from "@/crawl/identityAccumulator";
import { createProgressEvent, emitProgress } from "@/crawl/progress";
import { classifyUniqueCapStop, sourceStateForStopReason } from "@/crawl/stopReasons";
import {
  CRAWL_KERNEL_VERSION,
  type CompactCrawlProgressEvent,
  type CrawlBudget,
  type CrawlMechanism,
  type DirectoryAdapter,
  type DirectoryCrawlResult,
  type InventoryEstimate,
} from "@/crawl/types";

export type DirectoryCrawlInput<TSession> = {
  adapter: DirectoryAdapter<TSession>;
  url: string;
  budget: CrawlBudget;
  signal?: AbortSignal;
  onProgress?: (event: CompactCrawlProgressEvent) => void;
  inventoryEstimate?: InventoryEstimate;
  shouldExtend?: (snapshot: {
    uniqueGrowth: number;
    duplicateRate: number;
    noGrowth: boolean;
    remainingBudget: CrawlBudget;
  }) => boolean;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Crawl cancelled");
    error.name = "AbortError";
    throw error;
  }
}

/**
 * Shared directory crawl lifecycle. Source-agnostic: adapters own parsing.
 */
export async function crawlDirectory<TSession>(
  input: DirectoryCrawlInput<TSession>,
): Promise<DirectoryCrawlResult> {
  const startedAt = Date.now();
  const used = emptyBudgetUsage();
  const identities = new IdentityAccumulator();
  let mechanism: CrawlMechanism = "static";
  let requestedUrl = input.url;
  let finalUrl = input.url;
  let session: TSession | undefined;
  let stopReason: DirectoryCrawlResult["stopReason"] = "no_growth";
  let cancelled = false;
  let lastDuplicateRate = 0;
  let uniqueGrowthTotal = 0;
  let extensionUsed = false;

  try {
    throwIfAborted(input.signal);
    const acquired = await input.adapter.acquire({
      url: input.url,
      budget: input.budget,
      signal: input.signal,
    });
    session = acquired.session;
    mechanism = acquired.mechanism;
    requestedUrl = acquired.requestedUrl;
    finalUrl = acquired.finalUrl;
    used.requests += 1;
    emitProgress(
      input.onProgress,
      createProgressEvent("acquired", identities.size, used.pagesOrScrolls),
    );

    while (true) {
      throwIfAborted(input.signal);
      const elapsedMs = Date.now() - startedAt;
      if (isBudgetExhausted(input.budget, { ...used, elapsedMs })) {
        stopReason = elapsedMs >= input.budget.maxDurationMs ? "timeout" : "max_budget";
        break;
      }
      const capStop = classifyUniqueCapStop({
        unique: identities.size,
        targetUnique: input.budget.targetUnique,
        maxUnique: input.budget.maxUnique,
        stopAtTarget: input.budget.stopAtTarget,
      });
      if (capStop) {
        stopReason = capStop;
        break;
      }

      const budgetRemaining = remainingBudget(input.budget, {
        ...used,
        elapsedMs,
        unique: identities.size,
      });

      const step = await input.adapter.grow({
        session,
        budgetRemaining,
        seen: identities.identities,
        signal: input.signal,
      });

      used.requests += step.requestsUsed;
      used.pagesOrScrolls += step.pagesOrScrollsUsed;
      used.actions += step.actionsUsed;

      const merge = identities.merge(step.cards);
      lastDuplicateRate = step.duplicateRate || merge.duplicateRate;
      uniqueGrowthTotal += merge.added;

      if (merge.added > 0) {
        emitProgress(
          input.onProgress,
          createProgressEvent("grew", identities.size, used.pagesOrScrolls),
        );
      }

      const afterCap = classifyUniqueCapStop({
        unique: identities.size,
        targetUnique: input.budget.targetUnique,
        maxUnique: input.budget.maxUnique,
        stopAtTarget: input.budget.stopAtTarget,
      });
      if (afterCap) {
        stopReason = afterCap;
        break;
      }

      if (step.stopHint) {
        stopReason = step.stopHint;
        break;
      }
      if (step.done) {
        stopReason = "exhausted";
        break;
      }
      if (!step.grew && merge.added === 0) {
        if (
          !extensionUsed &&
          input.shouldExtend?.({
            uniqueGrowth: uniqueGrowthTotal,
            duplicateRate: lastDuplicateRate,
            noGrowth: true,
            remainingBudget: remainingBudget(input.budget, {
              ...used,
              elapsedMs: Date.now() - startedAt,
              unique: identities.size,
            }),
          })
        ) {
          extensionUsed = true;
          continue;
        }
        stopReason = "no_growth";
        break;
      }

      const cap = uniqueCap(input.budget);
      if (typeof cap === "number" && identities.size >= cap) {
        stopReason = input.budget.stopAtTarget ? "target_reached" : "maximum_cards_reached";
        break;
      }

      if (
        !extensionUsed &&
        merge.added > 0 &&
        lastDuplicateRate < 0.85 &&
        typeof input.budget.maxExtensionUnits === "number" &&
        input.budget.maxExtensionUnits > 0 &&
        used.pagesOrScrolls >= input.budget.maxPagesOrScrolls
      ) {
        extensionUsed = true;
        input.budget.maxPagesOrScrolls += 1;
      }
    }
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || /cancel/i.test(error.message))) {
      cancelled = true;
      stopReason = "cancelled";
    } else {
      stopReason = "acquisition_failed";
    }
  } finally {
    if (session != null && input.adapter.release) {
      try {
        await input.adapter.release(session);
      } catch {
        // Release failures must not mask crawl stop reason.
      }
    }
  }

  const cards =
    typeof input.budget.maxUnique === "number"
      ? identities.values().slice(0, input.budget.maxUnique)
      : identities.values();

  emitProgress(
    input.onProgress,
    createProgressEvent("stopped", cards.length, used.pagesOrScrolls, stopReason),
  );

  const targetReached =
    typeof input.budget.targetUnique === "number" && cards.length >= input.budget.targetUnique;

  return {
    mechanism,
    requestedUrl,
    finalUrl,
    cards,
    inventory: {
      observed: input.inventoryEstimate,
      collectedRaw: identities.collectedRaw,
      collectedUnique: cards.length,
    },
    stopReason,
    sourceState: sourceStateForStopReason(stopReason),
    pagesOrScrolls: used.pagesOrScrolls,
    requests: used.requests,
    actions: used.actions,
    listingDurationMs: Date.now() - startedAt,
    kernelVersion: CRAWL_KERNEL_VERSION,
    adapterId: input.adapter.id,
    adapterVersion: input.adapter.version,
    targetReached,
    cancelled,
  };
}
