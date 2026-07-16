import { randomUUID } from "node:crypto";
import type { Json } from "@/lib/supabase/database.types";
import { getCollector } from "@/collectors/registry";
import {
  DEFAULT_COLLECTOR_TIMEOUT_MS,
  emptyCollectorResult,
} from "@/collectors/types";
import { collectWithSourceLocks } from "@/discovery/sourceLocks";
import { readDiscoveryRuntimeConfig } from "@/discovery/config";
import { hasSupabaseConfig, getServerEnv } from "@/config/env";
import type {
  AcceptedCandidate,
  AgentRunSummary,
  DiscoverySourceId,
  DiscoveryPreferences,
  RejectedCandidate,
  ScoringResult,
  SourceRunStats,
} from "@/core/discovery/types";
import {
  classifyHackathonEvent,
  shouldEnterNormalScoring,
} from "@/core/classifyEventPage";
import { enrichPromisingLeads } from "@/core/enrichLead";
import { extractHackathonEvents } from "@/core/extract";
import { mergeCrossSourceEvents } from "@/core/mergeEvents";
import { evaluateEligibility, scoreHackathonEvent } from "@/core/score";
import { verifyHackathonEvent } from "@/core/verify";
import { sourceAuthority } from "@/core/dedupe";
import { applicationDeadlineFor, eventStartFor } from "@/core/dates";
import { completeAgentRun, createAgentRun } from "@/server/agent/runs";
import {
  buildAcceptedSummary,
  deadlineStateFor,
  emptySummary,
} from "@/agent/summary";
import { formatSearchPlan, planSearchQueries } from "@/agent/planSearchQueries";
import { formatXPlan, planXQueries } from "@/agent/planXQueries";
import {
  createEventEmitter,
  type DiscoveryEventSink,
} from "@/discovery/events";
import { aggregateCollectorResults } from "@/discovery/collectorAggregation";
import type { CustomSource } from "@/server/customSources/types";
import { collectCustomSourceWithV2Routing } from "@/discovery/genericScraperV2Mode";
import {
  buildSourceTelemetry,
  compactSourceStatsForSummary,
} from "@/discovery/sourceTelemetry";
import type {
  DiscoveryPerformanceTracker,
} from "@/discovery/performance";
import {
  finalizePersistenceShadow,
  isPersistenceBatchShadowEnabled,
  acceptedCandidatesToWriteSet,
  preparePersistenceShadow,
  type PersistenceShadowState,
} from "@/discovery/persistence/persistenceShadow";
import type { IncomingCandidateWrite } from "@/discovery/persistence/persistencePlan";
import {
  createPersistenceStrategy,
  formatPersistenceSummary,
  selectPersistenceStrategyFromEnv,
} from "@/discovery/persistence/strategies";
import { createProgressCoalescer } from "@/discovery/progressCoalescer";
import { compactStageBudget, stageBudgetForProfile } from "@/discovery/stageBudgets";

const SUPABASE_ENV_MESSAGE =
  "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env.local, or run with --dry-run.";

const MOCK_WRITE_REFUSED_MESSAGE =
  'Refusing to upsert mock-sourced candidates into the live database while USE_MOCK_CANDIDATES=false. Re-run with --dry-run, set USE_MOCK_CANDIDATES=true for local fixtures, or pass --allow-mock-writes to override.';

export type DiscoveryPipelineOptions = {
  allowMockWrites?: boolean;
  sourceTimeoutMs?: number;
  totalTimeoutMs?: number;
  showSearchPlan?: boolean;
  showXPlan?: boolean;
  dryRunPlan?: boolean;
  verbose?: boolean;
  agentObservability?: AgentRunSummary["agent"];
  now?: Date;
  runId?: string;
  eventSink?: DiscoveryEventSink;
  cancellationSignal?: AbortSignal;
  /** When true, search/X plan text is emitted as events instead of console.log. */
  emitPlansAsEvents?: boolean;
  customSources?: CustomSource[];
  performanceTracker?: DiscoveryPerformanceTracker;
  onAcceptedWriteSet?: (writeSet: IncomingCandidateWrite[]) => void;
};

function initSourceStats(sources: DiscoverySourceId[]): Map<DiscoverySourceId, SourceRunStats> {
  const stats = new Map<DiscoverySourceId, SourceRunStats>();
  for (const source of sources) {
    stats.set(source, {
      source,
      leadsFound: 0,
      queueReady: 0,
      needsReview: 0,
      invalidRejected: 0,
      accepted: 0,
      rejected: 0,
      errors: [],
      warnings: [],
      durationMs: 0,
      outcome: "executed",
    });
  }
  return stats;
}

function sourceAccountingFromStats(
  stats: SourceRunStats[],
): AgentRunSummary["sourceAccounting"] {
  return {
    executedSources: stats
      .filter((item) => item.outcome === "executed")
      .map((item) => item.source),
    skippedSources: stats
      .filter((item) => item.outcome === "skipped")
      .map((item) => item.source),
    failedSources: stats
      .filter((item) => item.outcome === "failed")
      .map((item) => item.source),
    degradedSources: stats
      .filter((item) => item.outcome === "degraded")
      .map((item) => item.source),
    authRequiredSources: stats
      .filter((item) => item.outcome === "auth_required")
      .map((item) => item.source),
  };
}

function assertMockWritesAllowed(
  preferences: DiscoveryPreferences,
  dryRun: boolean,
  allowMockWrites: boolean,
): void {
  if (dryRun || allowMockWrites) return;
  if (!preferences.sources.includes("mock")) return;

  const env = getServerEnv();
  if (env.USE_MOCK_CANDIDATES) return;

  throw new Error(MOCK_WRITE_REFUSED_MESSAGE);
}

function reviewOnlyScore(reasons: string[], redFlags: string[]): ScoringResult {
  return {
    score: 0,
    whyMatch: ["Needs human review before scoring"],
    redFlags: [...new Set([...reasons, ...redFlags])],
    rejected: false,
  };
}

function isBroadReview(preferences: DiscoveryPreferences): boolean {
  return preferences.reviewPolicy !== "strict";
}

function isHardInvalidVerificationReason(reason: string): boolean {
  return /deadline has passed|registration closed|event already ended|stale title year|title year is in the past/i.test(
    reason,
  );
}

const SOFT_APPLICATION_DEADLINE_FLAG = "Applications close: Unknown";

/** Review-gate reasons for broad-review mode (exported for focused closure tests). */
export function broadNeedsReviewReasons(
  event: {
    deadline?: string;
    registrationDeadline?: string;
    applicationDeadline?: string;
    startDate?: string;
    eventStartDate?: string;
    applyUrl?: string;
    officialUrl?: string;
  },
  score: ScoringResult,
): string[] {
  // Missing application deadline alone must not force NEEDS_REVIEW when the event
  // date is verified; quality.missingDeadlines still tracks the soft gap.
  const reasons = score.redFlags.filter((flag) => flag !== SOFT_APPLICATION_DEADLINE_FLAG);
  if (!eventStartFor(event)) reasons.push("Event date unclear");
  if (!event.applyUrl) reasons.push("Application URL missing or unclear");
  if (!event.officialUrl) reasons.push("Official URL missing or unclear");
  return [...new Set(reasons)];
}

function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Discovery run cancelled");
    error.name = "DiscoveryCancelledError";
    throw error;
  }
}

export function isDiscoveryCancelledError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "DiscoveryCancelledError" ||
      error.message === "Discovery run cancelled")
  );
}

export type CollectorBudgetResult<T> = {
  result: T;
  timedOut: boolean;
};

export async function awaitCollectorResultsWithTotalBudget<T>(
  collectorPromise: Promise<T>,
  totalTimeoutMs: number,
): Promise<CollectorBudgetResult<T>> {
  const timeoutSentinel = Symbol("collector-timeout");
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise = new Promise<typeof timeoutSentinel>((resolve) => {
      timeoutHandle = setTimeout(() => {
        resolve(timeoutSentinel);
      }, totalTimeoutMs);
    });

    const result = await Promise.race([collectorPromise, timeoutPromise]);
    if (result !== timeoutSentinel) {
      return { result, timedOut: false };
    }

    return {
      result: await collectorPromise,
      timedOut: true,
    };
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Core discovery pipeline shared by CLI and web job executors.
 * Emits structured progress events; does not write directly to stdout.
 */
export async function executeDiscoveryPipeline(
  preferences: DiscoveryPreferences,
  dryRun: boolean,
  options: DiscoveryPipelineOptions = {},
): Promise<AgentRunSummary> {
  const startedAt = Date.now();
  const runId = options.runId ?? randomUUID();
  const emitter = createEventEmitter(runId, options.eventSink);
  const summary = emptySummary(preferences.rawCommand, preferences, dryRun);
  const customSourceIds = (options.customSources ?? []).map(
    (source) => `custom:${source.slug}` as const,
  );
  const sourceStats = initSourceStats([...preferences.sources, ...customSourceIds]);
  const allowMockWrites = options.allowMockWrites === true;
  const runtimeConfig = readDiscoveryRuntimeConfig();
  const sourceTimeoutMs = options.sourceTimeoutMs ?? DEFAULT_COLLECTOR_TIMEOUT_MS;
  const totalTimeoutMs = options.totalTimeoutMs ?? runtimeConfig.jobTimeoutMs;
  const effectiveSourceTimeout = Math.min(sourceTimeoutMs, totalTimeoutMs);
  const now = options.now ?? new Date();
  const performanceTracker = options.performanceTracker;
  summary.verbose = options.verbose === true;
  summary.agent = options.agentObservability;

  await emitter.emit("run_started", `Starting discovery for: ${preferences.rawCommand}`, {
    metadata: {
      sources: preferences.sources,
      dryRun,
    },
  });

  const logPlan = (label: string, body: string) => {
    if (options.emitPlansAsEvents) {
      void emitter.emit("source_progress", `${label}\n${body}`, {
        metadata: { plan: label },
      });
      return;
    }
    console.log(label);
    console.log(body);
    console.log("");
  };

  if (options.showSearchPlan || options.dryRunPlan) {
    const queries = planSearchQueries(preferences);
    logPlan("Search plan:", formatSearchPlan(queries));
  }

  if (options.showXPlan || (options.dryRunPlan && preferences.sources.includes("x"))) {
    const xQueries = planXQueries(preferences);
    logPlan("X plan:", formatXPlan(xQueries));
  }

  if (options.dryRunPlan) {
    summary.warnings.push("Dry-run plan only; collectors were not executed.");
    summary.durationMs = Date.now() - startedAt;
    summary.sourceStats = [...sourceStats.values()];
    summary.sourceAccounting = sourceAccountingFromStats(summary.sourceStats);
    summary.performance = performanceTracker?.finalize();
    await emitter.emit("run_completed", "Dry-run plan only; collectors were not executed.", {
      metadata: { dryRunPlan: true },
    });
    return summary;
  }

  assertMockWritesAllowed(preferences, dryRun, allowMockWrites);
  assertNotCancelled(options.cancellationSignal);

  if (!dryRun && !hasSupabaseConfig(getServerEnv())) {
    throw new Error(SUPABASE_ENV_MESSAGE);
  }

  let agentRunId: string | null = null;

  if (!dryRun) {
    try {
      agentRunId = await createAgentRun({
        command: preferences.rawCommand,
        preferences: preferences as unknown as Json,
        sources: preferences.sources,
      });
    } catch (error) {
      summary.warnings.push(
        `Failed to create agent run record: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  try {
    assertNotCancelled(options.cancellationSignal);

    const stageBudget = stageBudgetForProfile(preferences.profile);
    const progressStatsBySource = new Map<
      string,
      { rawCallbacks: number; emitted: number; coalesced: number }
    >();
    const coalescers = new Map<string, ReturnType<typeof createProgressCoalescer>>();

    const coalescerFor = (source: string) => {
      let coalescer = coalescers.get(source);
      if (!coalescer) {
        coalescer = createProgressCoalescer({
          emit: async (message, metadata) => {
            await emitter.emit("source_progress", message, {
              source,
              metadata: {
                ...metadata,
                compact: true,
              },
            });
          },
        });
        coalescers.set(source, coalescer);
      }
      return coalescer;
    };

    for (const source of preferences.sources) {
      await emitter.emit("source_started", `Starting…`, { source });
    }

    const collectorInput = {
      preferences,
      maxResults: preferences.maxResults,
      timeoutMs: effectiveSourceTimeout,
      dryRun,
      requestId: agentRunId ?? runId,
    };
    const collectionStartedAtMs = performanceTracker?.now();
    const collectorPromise = collectWithSourceLocks(
      preferences.sources,
      async (source) => {
        const collector = getCollector(source);
        if (!collector) {
          const missing = emptyCollectorResult(source);
          missing.errors.push(`No collector registered for source: ${source}`);
          return missing;
        }
        const startedAt = Date.now();
        const coalescer = coalescerFor(source);
        try {
          const result = await collector.collect({
            ...collectorInput,
            logger: (message) => {
              coalescer.note(message);
            },
          });
          await coalescer.flushForce();
          progressStatsBySource.set(source, coalescer.stats());
          return result;
        } catch (error) {
          await coalescer.flushForce();
          progressStatsBySource.set(source, coalescer.stats());
          const failed = emptyCollectorResult(source, startedAt);
          failed.errors.push(
            error instanceof Error
              ? error.message
              : `Collector ${source} failed`,
          );
          return failed;
        }
      },
      {
        runId,
        eventSink: options.eventSink,
        cancellationSignal: options.cancellationSignal,
        lockWaitTimeoutMs: runtimeConfig.sourceLockWaitMs,
        publicConcurrency: runtimeConfig.publicSourceConcurrency,
        onCollectorTiming: (timing) => performanceTracker?.recordCollector(timing),
      },
    );

    const collectorBudget = await awaitCollectorResultsWithTotalBudget(
      collectorPromise,
      totalTimeoutMs,
    );
    const collectorResults = collectorBudget.result;
    const timedOut = collectorBudget.timedOut;
    if (timedOut) {
      summary.warnings.push(
        `Total collector budget ${totalTimeoutMs}ms reached; waiting for bounded in-flight collectors to return explicit outcomes.`,
      );
    }

    assertNotCancelled(options.cancellationSignal);

    const customResults = [];
    const customCollectionStartedAtMs = performanceTracker?.now();
    for (const customSource of options.customSources ?? []) {
      assertNotCancelled(options.cancellationSignal);
      const customId = `custom:${customSource.slug}` as const;
      const customStartedAtMs = performanceTracker?.now();
      await emitter.emit("source_started", "Starting...", { source: customId });
      const customCoalescer = coalescerFor(customId);
      const customResult = await collectCustomSourceWithV2Routing(customSource, {
        timeoutMs: effectiveSourceTimeout,
        logger: (message) => {
          const unprefixed = message.replace(new RegExp(`^\\[custom:${customSource.slug}\\]\\s*`), "");
          customCoalescer.note(unprefixed);
        },
        persistHealth: !dryRun,
      });
      await customCoalescer.flushForce();
      progressStatsBySource.set(customId, customCoalescer.stats());
      const customEndedAtMs = performanceTracker?.now();
      if (customStartedAtMs != null && customEndedAtMs != null) {
        performanceTracker?.recordCollector({
          source: customId,
          waitMs: 0,
          executionMs: customEndedAtMs - customStartedAtMs,
          totalMs: customEndedAtMs - customStartedAtMs,
          rawLeadCount: customResult.diagnostics.discovered,
          returnedLeadCount: customResult.leads.length,
          outcome: customResult.status,
          diagnostics: {
            discovered: customResult.diagnostics.discovered,
            returned: customResult.diagnostics.returned,
            detectedUnits: customResult.diagnostics.detectedUnits ?? 0,
            candidateUnits: customResult.diagnostics.candidateUnits ?? 0,
            normalizedLeads: customResult.diagnostics.normalizedLeads ?? 0,
          },
        });
      }
      customResults.push({ ...customResult, source: customId });
    }
    if (customCollectionStartedAtMs != null && (options.customSources?.length ?? 0) > 0) {
      performanceTracker?.recordStage(
        "customSourceCollection",
        customCollectionStartedAtMs,
        performanceTracker.now(),
        { itemCount: options.customSources?.length ?? 0 },
      );
    }
    if (collectionStartedAtMs != null) {
      performanceTracker?.recordStage(
        "collection",
        collectionStartedAtMs,
        performanceTracker.now(),
        { itemCount: collectorResults.length + customResults.length },
      );
    }

    const aggregation = aggregateCollectorResults([...collectorResults, ...customResults]);
    collectorResults.splice(0, collectorResults.length, ...aggregation.results);
    summary.warnings.push(...aggregation.warnings);

    await emitter.emit(
      "source_progress",
      `Collector returns: ${aggregation.sourceReturns
        .map((item) => `${item.source}=${item.returned}/${item.discovered}`)
        .join(", ")}`,
      {
        source: "collection",
        metadata: {
          sourceReturns: aggregation.sourceReturns,
          rawLeads: aggregation.leads.length,
          timedOut,
        },
      },
    );

    let leads = aggregation.leads;
    summary.rawLeads = leads.length;

    const collectorResultsBySource = new Map(
      collectorResults.map((result) => [result.source, result] as const),
    );

    for (const result of collectorResults) {
      const stats = sourceStats.get(result.source);
      if (!stats) continue;
      stats.leadsFound = result.leads.length;
      stats.durationMs = result.durationMs;
      stats.errors.push(...result.errors);
      stats.warnings.push(...result.warnings);
      const verbose = options.verbose === true;
      const sourceWarnings = result.warnings.filter(
        (warning) =>
          verbose ||
          !/fingerprint|page-fingerprint|page fingerprint|rawHtml|selector dump/i.test(
            warning,
          ),
      );
      summary.warnings.push(
        ...sourceWarnings.map((warning) => `[${result.source}] ${warning}`),
      );
      summary.errors.push(
        ...result.errors.map((error) => `[${result.source}] ${error}`),
      );

      const authRequired =
        result.status === "auth_required" ||
        result.errors.some((error) =>
          /auth|login|sign[\s-]?in|session/i.test(error),
        );
      const degraded =
        result.status === "degraded" ||
        result.status === "failed" ||
        result.errors.length > 0 ||
        result.warnings.some((warning) =>
          /degraded|timeout|rate|parser|ui may have changed|zero matching|no matching/i.test(
            warning,
          ),
        );

      if (authRequired) {
        stats.outcome = "auth_required";
        const message =
          result.errors.find((error) => /auth|login|sign[\s-]?in|session/i.test(error)) ??
          result.errors[0] ??
          "Authentication required";
        await emitter.emit(
          "source_auth_required",
          message,
          {
            source: result.source,
            level: "warning",
            metadata: { leadsFound: result.leads.length, durationMs: result.durationMs },
          },
        );
      } else if (degraded && result.leads.length === 0) {
        stats.outcome = result.status === "failed" ? "failed" : "degraded";
        const message =
          result.errors[0] ??
          result.warnings.find((warning) =>
            /parser|ui may have changed|zero matching|no matching|timeout|rate|degraded/i.test(
              warning,
            ),
          ) ??
          result.warnings[0] ??
          "Source degraded";
        await emitter.emit(
          "source_degraded",
          message,
          {
            source: result.source,
            level: "warning",
            metadata: { leadsFound: 0, durationMs: result.durationMs },
          },
        );
      } else {
        stats.outcome = degraded ? "degraded" : "executed";
        const unique =
          typeof result.metrics?.uniqueCards === "number"
            ? result.metrics.uniqueCards
            : result.diagnostics.discovered || result.leads.length;
        const stopReason =
          result.diagnostics.stopReason ??
          result.warnings.find((warning) => /stop_reason|exhaust|timeout|no_growth|page_cap/i.test(warning));
        await emitter.emit(
          "source_completed",
          `${result.leads.length} collected, ${unique} unique${
            stopReason ? `, stop: ${stopReason}` : ""
          }`,
          {
            source: result.source,
            metadata: {
              leadsFound: result.leads.length,
              unique,
              durationMs: result.durationMs,
              errors: result.errors.length,
              warnings: result.warnings.length,
              stopReason,
              metrics: result.metrics ?? null,
            },
          },
        );
      }

      if (result.source === "x" && result.metrics) {
        const m = result.metrics;
        summary.xDiscovery = {
          queriesPlanned: m.queriesPlanned ?? 0,
          queriesExecuted: m.queriesExecuted ?? 0,
          postsReturned: m.postsReturned ?? 0,
          postsDeduped: m.postsDeduped ?? 0,
          postsWithLinks: m.postsWithLinks ?? 0,
          postsKept: m.postsKept ?? result.leads.length,
          postsRejectedNoise: m.postsRejectedNoise ?? 0,
          pagesEnriched: 0,
          durationMs: result.durationMs,
          rateQuotaWarnings: m.rateQuotaWarnings ?? 0,
        };
      }
    }

    assertNotCancelled(options.cancellationSignal);
    await emitter.emit("enrichment_started", "Enriching promising leads…", {
      metadata: compactStageBudget(stageBudget),
    });

    const enrichment = performanceTracker
      ? await performanceTracker.measure(
          "enrichment",
          () =>
            enrichPromisingLeads(leads, {
              timeoutMs: Math.min(stageBudget.enrichmentTimeoutMs, effectiveSourceTimeout),
              maxPages: stageBudget.enrichmentMaxPages,
              concurrency: stageBudget.enrichmentConcurrency,
            }),
          { itemCount: leads.length },
        )
      : await enrichPromisingLeads(leads, {
          timeoutMs: Math.min(stageBudget.enrichmentTimeoutMs, effectiveSourceTimeout),
          maxPages: stageBudget.enrichmentMaxPages,
          concurrency: stageBudget.enrichmentConcurrency,
        });
    leads = enrichment.leads;
    summary.enriched = enrichment.enrichedCount;
    summary.warnings.push(...enrichment.warnings.map((warning) => `[enrich] ${warning}`));

    if (summary.xDiscovery) {
      const xLeadsAfter = leads.filter((lead) => lead.source === "x");
      summary.xDiscovery.pagesEnriched = xLeadsAfter.filter((lead) => {
        const meta = lead.metadata ?? {};
        return Boolean(meta.officialUrl || meta.enriched);
      }).length;
    }

    assertNotCancelled(options.cancellationSignal);
    await emitter.emit("verification_started", `${leads.length} raw leads`);

    const extracted = performanceTracker
      ? performanceTracker.measureSync(
          "extraction",
          () => extractHackathonEvents(leads, { now }),
          { itemCount: leads.length },
        )
      : extractHackathonEvents(leads, { now });
    const merged = performanceTracker
      ? performanceTracker.measureSync(
          "dedupe",
          () => mergeCrossSourceEvents(extracted),
          { itemCount: extracted.length },
        )
      : mergeCrossSourceEvents(extracted);
    summary.extracted = extracted.length;
    summary.uniqueLeads = merged.events.length;
    summary.crossSourceMerges = merged.mergeCount;
    summary.quality.crossSourceMerges = merged.mergeCount;

    await emitter.emit(
      "dedupe_completed",
      `${merged.events.length} unique candidates`,
      {
        metadata: {
          extracted: extracted.length,
          unique: merged.events.length,
          merges: merged.mergeCount,
        },
      },
    );

    const accepted: AcceptedCandidate[] = [];
    const rejected: RejectedCandidate[] = [];

    const markQueued = (source: DiscoverySourceId, status: "NEW" | "NEEDS_REVIEW") => {
      const stats = sourceStats.get(source);
      if (!stats) return;
      stats.accepted += 1;
      if (status === "NEEDS_REVIEW") stats.needsReview += 1;
      else stats.queueReady += 1;
    };
    const markInvalidRejected = (source: DiscoverySourceId) => {
      const stats = sourceStats.get(source);
      if (!stats) return;
      stats.rejected += 1;
      stats.invalidRejected += 1;
    };
    const broadReview = isBroadReview(preferences);

    const verificationStartedAtMs = performanceTracker?.now();
    for (const event of merged.events) {
      assertNotCancelled(options.cancellationSignal);
      try {
        const hardEligibility = evaluateEligibility(event, preferences, { now });
        if (!hardEligibility.eligible) {
          const reason = hardEligibility.rejectionReason ?? hardEligibility.reasons[0] ?? "Failed hard constraints";
          if (/deadline|ended|finished|stale title/i.test(reason)) {
            summary.quality.historicalOrExpiredFiltered += 1;
          }
          rejected.push({
            name: event.name,
            source: event.source,
            stage: "verification",
            reason,
          });
          markInvalidRejected(event.source);
          continue;
        }

        const classified = classifyHackathonEvent(event);

        if (classified.classification === "EVENT_DIRECTORY") {
          summary.quality.directoriesFiltered += 1;
          rejected.push({
            name: event.name,
            source: event.source,
            stage: "verification",
            reason: `Directory/category page — ${classified.reasons[0] ?? "not an individual event"}`,
          });
          markInvalidRejected(event.source);
          continue;
        }

        if (classified.classification === "ARTICLE") {
          summary.quality.articlesFiltered += 1;
          rejected.push({
            name: event.name,
            source: event.source,
            stage: "verification",
            reason: `Article/listicle — ${classified.reasons[0] ?? "not an individual event"}`,
          });
          markInvalidRejected(event.source);
          continue;
        }

        if (
          classified.classification === "ORGANIZATION_PAGE" ||
          classified.classification === "HISTORICAL_EVENT"
        ) {
          summary.quality.historicalOrExpiredFiltered += 1;
          rejected.push({
            name: event.name,
            source: event.source,
            stage: "verification",
            reason: `${classified.classification} — ${classified.reasons[0] ?? "filtered"}`,
          });
          markInvalidRejected(event.source);
          continue;
        }

        if (classified.classification === "UNCERTAIN") {
          summary.quality.uncertainNeedsReview += 1;
          const verification = verifyHackathonEvent(event, { now });
          if (verification.status === "rejected") {
            const reason = verification.reasons[0] ?? "Failed verification";
            if (!broadReview || isHardInvalidVerificationReason(reason)) {
              summary.quality.historicalOrExpiredFiltered += 1;
              rejected.push({
                name: event.name,
                source: event.source,
                stage: "verification",
                reason,
              });
              markInvalidRejected(event.source);
              continue;
            }
          }

          accepted.push({
            event,
            score: reviewOnlyScore(classified.reasons, verification.redFlags),
            fingerprint: "",
            status: "NEEDS_REVIEW",
            classification: classified.classification,
            sourceAuthority: sourceAuthority(event.source),
            deadlineState: deadlineStateFor(event, now),
            hasOfficialUrl: Boolean(event.officialUrl),
            hasApplyUrl: Boolean(event.applyUrl),
          });
          markQueued(event.source, "NEEDS_REVIEW");
          continue;
        }

        if (!shouldEnterNormalScoring(classified.classification)) {
          rejected.push({
            name: event.name,
            source: event.source,
            stage: "verification",
            reason: `Unsupported classification ${classified.classification}`,
          });
          markInvalidRejected(event.source);
          continue;
        }

        summary.quality.individualEvents += 1;

        const verification = verifyHackathonEvent(event, { now });
        if (verification.status === "rejected") {
          const reasonText = verification.reasons.join(" ");
          if (/deadline|ended|stale title/i.test(reasonText)) {
            summary.quality.historicalOrExpiredFiltered += 1;
          }
          if (!broadReview || isHardInvalidVerificationReason(reasonText)) {
            rejected.push({
              name: event.name,
              source: event.source,
              stage: "verification",
              reason: verification.reasons[0] ?? "Failed verification",
            });
            markInvalidRejected(event.source);
            continue;
          }
        }

        const score = scoreHackathonEvent(event, preferences, { now });
        if (score.rejected) {
          const reason = score.rejectionReason ?? "Rejected by eligibility/scoring";
          if (!broadReview || isHardInvalidVerificationReason(reason)) {
            rejected.push({
              name: event.name,
              source: event.source,
              stage: "scoring",
              reason,
            });
            markInvalidRejected(event.source);
            continue;
          }
        }

        if (!applicationDeadlineFor(event)) summary.quality.missingDeadlines += 1;
        if (!event.applyUrl) summary.quality.missingApplyLinks += 1;

        const reviewReasons = broadReview ? broadNeedsReviewReasons(event, score) : [];
        const status =
          verification.status === "needs_review" || reviewReasons.length > 0
            ? "NEEDS_REVIEW"
            : "NEW";
        const finalScore =
          status === "NEEDS_REVIEW" && reviewReasons.length > 0
            ? {
                ...score,
                redFlags: [...new Set([...score.redFlags, ...reviewReasons])],
              }
            : score;
        accepted.push({
          event,
          score: finalScore,
          fingerprint: "",
          status,
          classification: classified.classification,
          sourceAuthority: sourceAuthority(event.source),
          deadlineState: deadlineStateFor(event, now),
          hasOfficialUrl: Boolean(event.officialUrl),
          hasApplyUrl: Boolean(event.applyUrl),
        });
        markQueued(event.source, status);
      } catch (error) {
        summary.errors.push(
          `${event.name}: ${error instanceof Error ? error.message : "processing failed"}`,
        );
      }
    }
    if (verificationStartedAtMs != null) {
      performanceTracker?.recordStage(
        "verification",
        verificationStartedAtMs,
        performanceTracker.now(),
        { itemCount: merged.events.length },
      );
    }

    summary.accepted = accepted.length;
    summary.rejected = rejected.length;
    summary.rejectedCandidates = rejected;
    summary.needsReview = accepted.filter((item) => item.status === "NEEDS_REVIEW").length;
    options.onAcceptedWriteSet?.(
      acceptedCandidatesToWriteSet(accepted, {
        now,
        agentRunId,
      }),
    );

    const strategySelection = selectPersistenceStrategyFromEnv();
    if (strategySelection.warning) {
      summary.warnings.push(strategySelection.warning);
    }
    const persistenceStrategy = createPersistenceStrategy(strategySelection);

    assertNotCancelled(options.cancellationSignal);
    await emitter.emit(
      "persistence_started",
      `[persistence] Strategy: ${persistenceStrategy.name}`,
    );
    if (dryRun) {
      await emitter.emit("persistence_started", "Dry-run persistence…");
    } else {
      await emitter.emit("persistence_started", "Persisting candidates…");
    }

    let persistenceShadowState: PersistenceShadowState | undefined;
    if (!dryRun && isPersistenceBatchShadowEnabled()) {
      try {
        persistenceShadowState = await preparePersistenceShadow(accepted, {
          now,
          agentRunId,
        });
      } catch (error) {
        summary.warnings.push(
          `[persistence-shadow] planning failed: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }

    const persistenceStartedAtMs = performanceTracker?.now();
    const persistenceResult = await persistenceStrategy.persist({
      accepted,
      dryRun,
      now,
      agentRunId,
      performanceTracker,
      assertNotCancelled: () => assertNotCancelled(options.cancellationSignal),
    });
    const persistenceTiming = persistenceResult.timing;
    summary.created += persistenceResult.created;
    summary.updated += persistenceResult.updated;
    summary.wouldCreate += persistenceResult.wouldCreate;
    summary.wouldUpdate += persistenceResult.wouldUpdate;
    summary.stored += persistenceResult.stored;
    summary.duplicatesUpdated += persistenceResult.duplicatesUpdated;
    summary.evidenceWritten += persistenceResult.evidenceWritten;
    summary.wouldAttachEvidence += persistenceResult.wouldAttachEvidence;
    summary.storageFailures += persistenceResult.storageFailures;
    summary.warnings.push(...persistenceResult.warnings);
    summary.errors.push(...persistenceResult.errors);
    await emitter.emit("persistence_completed", formatPersistenceSummary(persistenceResult), {
      metadata: {
        strategy: persistenceResult.strategy,
        created: persistenceResult.created,
        updated: persistenceResult.updated,
        unchanged: persistenceResult.unchanged,
        evidence: persistenceResult.evidenceWritten,
        actions: persistenceResult.actionsWritten,
        failures: persistenceResult.storageFailures,
        dbCalls: persistenceResult.timing.databaseCalls ?? 0,
        durationMs: Math.round(persistenceResult.timing.totalMs),
      },
    });
    if (persistenceResult.strategy === "batch" && persistenceResult.postWriteParity) {
      await emitter.emit(
        "persistence_started",
        `[persistence] Post-write parity: ${persistenceResult.postWriteParity}`,
      );
    }
    if (performanceTracker && persistenceStartedAtMs != null) {
      persistenceTiming.totalMs = performanceTracker.now() - persistenceStartedAtMs;
      performanceTracker.recordStage("persistence", persistenceStartedAtMs, performanceTracker.now(), {
        itemCount: accepted.length,
        metadata: { dryRun, strategy: persistenceResult.strategy },
      });
      performanceTracker.setPersistence(persistenceTiming);
    }

    if (persistenceShadowState) {
      try {
        summary.persistenceShadow = await finalizePersistenceShadow(
          persistenceShadowState,
          summary,
        );
      } catch (error) {
        summary.warnings.push(
          `[persistence-shadow] comparison failed: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }

    summary.acceptedCandidates = buildAcceptedSummary(accepted);
    for (const stats of sourceStats.values()) {
      stats.telemetry = buildSourceTelemetry({
        stats,
        result: collectorResultsBySource.get(stats.source),
      });
    }
    summary.sourceStats = [...sourceStats.values()];
    summary.sourceAccounting = sourceAccountingFromStats(summary.sourceStats);
    summary.durationMs = Date.now() - startedAt;

    const completionStartedAtMs = performanceTracker?.now();
    if (agentRunId) {
      const runStatus =
        summary.errors.length > 0
          ? summary.stored > 0
            ? "PARTIAL"
            : "FAILED"
          : "COMPLETED";
      await completeAgentRun(agentRunId, summary, runStatus);
    }
    if (completionStartedAtMs != null) {
      const completionMs = performanceTracker!.now() - completionStartedAtMs;
      if (performanceTracker && persistenceTiming && !dryRun) {
        persistenceTiming.completionMs = completionMs;
        performanceTracker.setPersistence(persistenceTiming);
      }
      performanceTracker?.recordStage("completion", completionStartedAtMs, performanceTracker.now());
    }

    const created = dryRun ? summary.wouldCreate : summary.created;
    const updated = dryRun ? summary.wouldUpdate : summary.updated;
    const queueReady = Math.max(0, summary.accepted - summary.needsReview);
    const coalescingSummary = Object.fromEntries(
      [...progressStatsBySource.entries()].map(([source, stats]) => [
        source,
        {
          rawCallbacks: stats.rawCallbacks,
          emitted: stats.emitted,
          coalesced: stats.coalesced,
          ratio:
            stats.rawCallbacks > 0
              ? Number((stats.emitted / stats.rawCallbacks).toFixed(3))
              : 1,
        },
      ]),
    );
    await emitter.emit(
      "result_summary_updated",
      `${queueReady} candidates ready · ${summary.needsReview} need review`,
      {
        metadata: {
          queueReady,
          needsReview: summary.needsReview,
          accepted: summary.accepted,
          rejected: summary.rejected,
          previewNames: summary.acceptedCandidates.slice(0, 12).map((c) => c.name),
        },
      },
    );
    await emitter.emit(
      "run_completed",
      dryRun
        ? `Would create ${created}, would update ${updated} · queue-ready ${queueReady}, needs review ${summary.needsReview}`
        : `${created} created, ${updated} updated · queue-ready ${queueReady}, needs review ${summary.needsReview}`,
      {
        metadata: {
          rawLeads: summary.rawLeads,
          uniqueLeads: summary.uniqueLeads,
          accepted: summary.accepted,
          queueReady,
          rejected: summary.rejected,
          needsReview: summary.needsReview,
          created,
          updated,
          durationMs: summary.durationMs,
          dryRun,
          profile: preferences.profile ?? null,
          sourceAccounting: summary.sourceAccounting,
          sourceStats: compactSourceStatsForSummary(summary.sourceStats),
          // Keep event metadata compact — full acceptedCandidates live on job.summary.
          previewNames: summary.acceptedCandidates.slice(0, 12).map((c) => c.name),
          progressCoalescing: coalescingSummary,
          stageBudget: compactStageBudget(stageBudget),
          performance: performanceTracker?.finalize(),
          persistenceShadow: summary.persistenceShadow ?? null,
        },
      },
    );

    summary.performance = performanceTracker?.finalize();
    return summary;
  } catch (error) {
    summary.errors.push(error instanceof Error ? error.message : "Discovery run failed");
    summary.sourceStats = [...sourceStats.values()];
    summary.sourceAccounting = sourceAccountingFromStats(summary.sourceStats);
    summary.durationMs = Date.now() - startedAt;
    summary.performance = performanceTracker?.finalize();

    if (isDiscoveryCancelledError(error)) {
      await emitter.emit("run_cancelled", "Discovery run cancelled", {
        level: "warning",
        metadata: { durationMs: summary.durationMs, performance: summary.performance },
      });
    } else {
      await emitter.emit(
        "run_failed",
        error instanceof Error ? error.message : "Discovery run failed",
        {
          level: "error",
          metadata: { durationMs: summary.durationMs, performance: summary.performance },
        },
      );
    }

    if (agentRunId) {
      try {
        await completeAgentRun(agentRunId, summary, "FAILED");
      } catch {
        // Ignore secondary failures while reporting the original error.
      }
    }

    throw error;
  }
}
