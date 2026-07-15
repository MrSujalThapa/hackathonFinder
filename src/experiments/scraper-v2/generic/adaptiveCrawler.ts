import { performance } from "node:perf_hooks";
import { ExistingCustomRuntime } from "@/experiments/scraper-v2/generic/crawlRuntime";
import { summarizeDateCoverage } from "@/experiments/scraper-v2/generic/dateCoverage";
import { dedupeLeadsByIdentity, identityForLead } from "@/experiments/scraper-v2/generic/adaptiveIdentity";
import { buildCrawlPlan, planToDiscoveryBudget } from "@/experiments/scraper-v2/generic/adaptiveProfiles";
import { runGenericStructuredExtraction } from "@/experiments/scraper-v2/generic/structuredExtraction";
import { boundedMap, CircuitBreaker, HostConcurrencyLimiter, throwIfCancelled } from "@/experiments/scraper-v2/generic/runtimeControls";
import type {
  CrawlIntentInput,
  CrawlPlan,
  GenericShadowLead,
  GenericStructuredExtractionResult,
  SourceExperiment,
} from "@/experiments/scraper-v2/generic/types";

export type SourceYieldEstimate = {
  sourceUrl: string;
  validEventsPerSecond: number;
  validEventsPerPage: number;
  duplicateRate: number;
  expiredEventRate: number;
  browserCost: number;
  failureRate: number;
  uniqueContribution: number;
  dateCoverage: number;
};

export type AdaptiveCrawlSourceResult = {
  sourceUrl: string;
  result?: GenericStructuredExtractionResult;
  error?: string;
  validEvents: number;
  duplicatesRemoved: number;
  inHorizonEvents: number;
  openRegistrationEvents: number;
  pagesRequested: number;
  actionsExecuted: number;
  stopReason: string;
};

export type ProgressiveResultBatch = {
  batchId: string;
  sequence: number;
  sourceUrl: string;
  leads: GenericShadowLead[];
  validEvents: number;
  inHorizonEvents: number;
  duplicatesRemoved: number;
  persistenceDisabled: true;
};

export type AdaptiveCrawlResult = {
  plan: CrawlPlan;
  leads: GenericShadowLead[];
  batches: ProgressiveResultBatch[];
  sourceResults: AdaptiveCrawlSourceResult[];
  rawRecords: number;
  validEvents: number;
  openRegistrationEvents: number;
  inHorizonEvents: number;
  duplicatesRemoved: number;
  timeToFirst10Ms?: number;
  timeToFirst50Ms?: number;
  timeToTargetMs?: number;
  totalDurationMs: number;
  stopReason: "target_reached" | "sources_exhausted" | "deadline" | "cancelled";
  persistenceDisabled: true;
};

function hostKey(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}

function isOpenRegistration(lead: GenericShadowLead): boolean {
  return lead.normalizedStatus === "open" || lead.normalizedStatus === "upcoming" || lead.normalizedStatus === "ongoing";
}

function nowMs(): number {
  return performance.now();
}

function sourceScore(source: SourceExperiment, estimate: SourceYieldEstimate | undefined, plan: CrawlPlan): number {
  const expected = source.expectedMinimumEventCount ?? 0;
  const historyScore = estimate
    ? estimate.validEventsPerSecond * 0.35 +
      estimate.validEventsPerPage * 0.25 +
      estimate.uniqueContribution * 0.2 +
      estimate.dateCoverage * 0.1 -
      estimate.browserCost * 0.05 -
      estimate.failureRate * 0.15 -
      estimate.duplicateRate * 0.1 -
      estimate.expiredEventRate * 0.1
    : Math.min(expected / 100, 1) * 0.4;
  const latencyBoost = plan.prioritizeLatency && source.browserAllowed ? -0.05 : 0;
  const coverageBoost = plan.prioritizeCoverage ? Math.min(expected / 500, 0.3) : 0;
  return historyScore + latencyBoost + coverageBoost;
}

export function scheduleAdaptiveSources(input: {
  sources: SourceExperiment[];
  plan: CrawlPlan;
  yieldHistory?: SourceYieldEstimate[];
}): SourceExperiment[] {
  const byUrl = new Map(input.yieldHistory?.map((estimate) => [estimate.sourceUrl, estimate]));
  return [...input.sources]
    .sort((left, right) => sourceScore(right, byUrl.get(right.inputUrl), input.plan) - sourceScore(left, byUrl.get(left.inputUrl), input.plan))
    .slice(0, input.plan.maxSources);
}

function constrainSource(source: SourceExperiment, plan: CrawlPlan): SourceExperiment {
  return {
    ...source,
    maxPages: Math.min(source.maxPages, plan.maxPagesPerSource),
    maxRequests: Math.min(source.maxRequests, plan.maxRequestsPerSource),
    maxBrowserActions: Math.min(source.maxBrowserActions ?? plan.maxBrowserActionsPerSource, plan.maxBrowserActionsPerSource),
  };
}

function batchId(sourceUrl: string, sequence: number, leads: GenericShadowLead[]): string {
  return `${sequence}:${sourceUrl}:${leads.map((lead) => identityForLead(lead)?.key ?? lead.title).join("|").slice(0, 80)}`;
}

export async function runAdaptiveCrawl(input: {
  intent: CrawlIntentInput;
  sources: SourceExperiment[];
  yieldHistory?: SourceYieldEstimate[];
  signal?: AbortSignal;
  checkpointDir?: string;
  onBatch?: (batch: ProgressiveResultBatch) => void | Promise<void>;
}): Promise<AdaptiveCrawlResult> {
  const plan = buildCrawlPlan(input.intent);
  const budget = planToDiscoveryBudget(plan);
  const startedAt = nowMs();
  const scheduled = scheduleAdaptiveSources({ sources: input.sources, plan, yieldHistory: input.yieldHistory });
  const limiter = new HostConcurrencyLimiter(plan.profile === "light" ? 1 : 2);
  const breakers = new Map<string, CircuitBreaker>();
  const globalSeen = new Set<string>();
  const batches: ProgressiveResultBatch[] = [];
  const sourceResults: AdaptiveCrawlSourceResult[] = [];
  let timeToFirst10Ms: number | undefined;
  let timeToFirst50Ms: number | undefined;
  let timeToTargetMs: number | undefined;
  let validEvents = 0;
  let rawRecords = 0;
  let duplicatesRemoved = 0;
  let openRegistrationEvents = 0;
  let inHorizonEvents = 0;
  let sequence = 0;
  let stopReason: AdaptiveCrawlResult["stopReason"] = "sources_exhausted";

  async function runSource(source: SourceExperiment): Promise<void> {
    throwIfCancelled(input.signal);
    if (nowMs() - startedAt >= plan.maxDurationMs) {
      stopReason = "deadline";
      return;
    }
    if (validEvents >= plan.targetValidEvents && (!plan.dateHorizonEnd || inHorizonEvents > 0)) {
      stopReason = "target_reached";
      return;
    }
    const key = hostKey(source.inputUrl);
    const breaker = breakers.get(key) ?? new CircuitBreaker(2, 60_000);
    breakers.set(key, breaker);
    if (!breaker.canAttempt()) {
      sourceResults.push({
        sourceUrl: source.inputUrl,
        error: "source circuit breaker open",
        validEvents: 0,
        duplicatesRemoved: 0,
        inHorizonEvents: 0,
        openRegistrationEvents: 0,
        pagesRequested: 0,
        actionsExecuted: 0,
        stopReason: "circuit_open",
      });
      return;
    }

    await limiter.run(key, async () => {
      try {
        const result = await runGenericStructuredExtraction(constrainSource(source, plan), {
          runtime: new ExistingCustomRuntime(),
          budget,
          signal: input.signal,
          checkpointDir: plan.profile === "deep" || plan.profile === "exhaustive" ? input.checkpointDir : undefined,
        });
        rawRecords += result.counters.recordsInspected;
        const sourceDedupe = dedupeLeadsByIdentity(result.leads);
        const unique: GenericShadowLead[] = [];
        for (const lead of sourceDedupe.leads) {
          const identity = identityForLead(lead);
          const identityKey = identity?.key ?? `${lead.title}|${lead.startDate ?? ""}`;
          if (globalSeen.has(identityKey)) continue;
          globalSeen.add(identityKey);
          unique.push(lead);
        }
        const dateCoverage = summarizeDateCoverage({
          leads: unique,
          rawRecords: result.counters.recordsInspected,
          dateHorizonStart: plan.dateHorizonStart,
          dateHorizonEnd: plan.dateHorizonEnd,
        });
        const sourceDuplicates = result.leads.length - unique.length;
        validEvents += unique.length;
        duplicatesRemoved += Math.max(sourceDuplicates, sourceDedupe.duplicatesRemoved);
        openRegistrationEvents += unique.filter(isOpenRegistration).length;
        inHorizonEvents += dateCoverage.inHorizonEvents;
        if (unique.length > 0) {
          sequence += 1;
          const batch: ProgressiveResultBatch = {
            batchId: batchId(source.inputUrl, sequence, unique),
            sequence,
            sourceUrl: source.inputUrl,
            leads: unique,
            validEvents: unique.length,
            inHorizonEvents: dateCoverage.inHorizonEvents,
            duplicatesRemoved: sourceDuplicates,
            persistenceDisabled: true,
          };
          batches.push(batch);
          await input.onBatch?.(batch);
          if (validEvents >= 10 && timeToFirst10Ms === undefined) timeToFirst10Ms = Math.round(nowMs() - startedAt);
          if (validEvents >= 50 && timeToFirst50Ms === undefined) timeToFirst50Ms = Math.round(nowMs() - startedAt);
          if (validEvents >= plan.targetValidEvents && timeToTargetMs === undefined) timeToTargetMs = Math.round(nowMs() - startedAt);
        }
        sourceResults.push({
          sourceUrl: source.inputUrl,
          result,
          validEvents: unique.length,
          duplicatesRemoved: sourceDuplicates,
          inHorizonEvents: dateCoverage.inHorizonEvents,
          openRegistrationEvents: unique.filter(isOpenRegistration).length,
          pagesRequested: result.acquisition.pagesRequested ?? 1,
          actionsExecuted: result.acquisition.actionsExecuted ?? 0,
          stopReason: result.acquisition.paginationStopReason ?? "unknown",
        });
        breaker.recordSuccess();
      } catch (error) {
        breaker.recordFailure();
        sourceResults.push({
          sourceUrl: source.inputUrl,
          error: error instanceof Error ? error.message : String(error),
          validEvents: 0,
          duplicatesRemoved: 0,
          inHorizonEvents: 0,
          openRegistrationEvents: 0,
          pagesRequested: 0,
          actionsExecuted: 0,
          stopReason: "error",
        });
      }
    });
  }

  try {
    if (plan.profile === "light") {
      for (const source of scheduled) {
        await runSource(source);
        if (validEvents >= plan.targetValidEvents || nowMs() - startedAt >= plan.maxDurationMs) break;
      }
    } else {
      await boundedMap(scheduled, plan.profile === "standard" ? 2 : 3, async (source) => runSource(source));
    }
  } catch (error) {
    if (/cancel/i.test(error instanceof Error ? error.message : String(error))) stopReason = "cancelled";
    else throw error;
  }

  if (validEvents >= plan.targetValidEvents && stopReason === "sources_exhausted") stopReason = "target_reached";
  if (nowMs() - startedAt >= plan.maxDurationMs && stopReason === "sources_exhausted") stopReason = "deadline";

  return {
    plan,
    leads: batches.flatMap((batch) => batch.leads),
    batches,
    sourceResults,
    rawRecords,
    validEvents,
    openRegistrationEvents,
    inHorizonEvents,
    duplicatesRemoved,
    ...(timeToFirst10Ms !== undefined ? { timeToFirst10Ms } : {}),
    ...(timeToFirst50Ms !== undefined ? { timeToFirst50Ms } : {}),
    ...(timeToTargetMs !== undefined ? { timeToTargetMs } : {}),
    totalDurationMs: Math.round(nowMs() - startedAt),
    stopReason,
    persistenceDisabled: true,
  };
}
