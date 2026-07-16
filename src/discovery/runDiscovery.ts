import { randomUUID } from "node:crypto";
import { applyCliOptions, parseCommand } from "@/agent/parseCommand";
import { parseIntent } from "@/agent/llm/parseIntent";
import { planDiscovery } from "@/agent/llm/planDiscovery";
import { planDiscoveryWithLlm } from "@/agent/llm/planWithLlm";
import { runLoop } from "@/agent/runtime/runLoop";
import type {
  AgentRunSummary,
  DiscoveryProfile,
  DiscoverySourceId,
  DiscoveryPreferences,
  RemotePolicy,
  ReviewPolicy,
  SourceName,
  SourceRunStats,
} from "@/core/discovery/types";
import { readLlmConfig } from "@/lib/llm/config";
import {
  createEventEmitter,
  type DiscoveryEventSink,
} from "@/discovery/events";
import { getHakkuConnectionStatus } from "@/discovery/hakkuStatus";
import {
  executeDiscoveryPipeline,
  isDiscoveryCancelledError,
  type DiscoveryPipelineOptions,
} from "@/discovery/pipeline";
import {
  selectDiscoverySources,
  type SourceAvailability,
} from "@/discovery/selectSources";
import { reconcileSourcePlan } from "@/discovery/sourcePlan";
import { emptyQualityStats } from "@/agent/summary";
import { getEnabledSources } from "@/lib/sources/settingsStore";
import {
  getCustomSource,
  listCustomSources,
} from "@/server/customSources/repository";
import type { CustomSource } from "@/server/customSources/types";
import { createDiscoveryPerformanceTracker } from "@/discovery/performance";
import { stageBudgetForProfile } from "@/discovery/stageBudgets";
import type { IncomingCandidateWrite } from "@/discovery/persistence/persistencePlan";
import { devpostBudgetForProfile } from "@/collectors/devpost";
import { lumaBudgetForProfile } from "@/collectors/luma";

export type DiscoveryRunMode = "auto" | "agent" | "deterministic";

export type RunDiscoveryInput = {
  command: string;
  mode?: DiscoveryRunMode;
  sources?: SourceName[];
  maxAgentCalls?: number;
  dryRun?: boolean;
  eventSink?: DiscoveryEventSink;
  cancellationSignal?: AbortSignal;
  allowMockWrites?: boolean;
  sourceTimeoutMs?: number;
  totalTimeoutMs?: number;
  showSearchPlan?: boolean;
  showXPlan?: boolean;
  dryRunPlan?: boolean;
  verbose?: boolean;
  /** When true, treat request as “all enabled sources”. */
  allSources?: boolean;
  /** Enabled sources from Settings (defaults applied when omitted). */
  enabledSources?: SourceName[];
  availability?: Partial<Record<SourceName, SourceAvailability>>;
  maxResults?: number;
  reviewPolicy?: ReviewPolicy;
  showAgentPlan?: boolean;
  showAgentTrace?: boolean;
  runId?: string;
  queueWaitMs?: number;
  jobStartOverheadMs?: number;
  onAcceptedWriteSet?: (writeSet: IncomingCandidateWrite[]) => void;
};

export type DiscoveryRunResult = {
  runId: string;
  summary: AgentRunSummary;
  effectiveSources: DiscoverySourceId[];
  skippedSources: Array<{ source: SourceName; reason: string }>;
  cancelled: boolean;
};

type DiscoveryCommandFlags = {
  query: string;
  includeCustomSites: boolean;
  sourceNames?: string[];
  reviewPolicy?: ReviewPolicy;
  profile?: DiscoveryProfile;
  remotePolicy?: RemotePolicy;
  onsiteOnly?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
};

function commandMentionsSources(command: string): boolean {
  return /\b(hacklist|hakku|devpost|mlh|luma|web|mock|twitter|x)\b/i.test(command);
}

const BUILTIN_SOURCE_NAMES = new Set<SourceName>([
  "hacklist",
  "hakku",
  "devpost",
  "mlh",
  "luma",
  "web",
  "x",
  "mock",
]);

function parseDiscoveryCommandFlags(command: string): DiscoveryCommandFlags {
  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const queryParts: string[] = [];
  const sourceNames: string[] = [];
  let includeCustomSites = false;
  let reviewPolicy: ReviewPolicy | undefined;
  let profile: DiscoveryProfile | undefined;
  let remotePolicy: RemotePolicy | undefined;
  let onsiteOnly = false;
  let dryRun = false;
  let verbose = false;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    const lower = part.toLowerCase();
    const nextValue = () => {
      const value = parts[index + 1];
      if (!value || value.startsWith("--")) return undefined;
      index += 1;
      return value.replace(/^["']|["']$/g, "");
    };
    if (lower === "--include-custom-sites") {
      includeCustomSites = true;
      continue;
    }
    if (lower === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (lower === "--verbose") {
      verbose = true;
      continue;
    }
    if (lower === "--remote") {
      remotePolicy = "only";
      continue;
    }
    if (lower === "--include-remote") {
      remotePolicy = "include";
      continue;
    }
    if (lower === "--onsite-only") {
      remotePolicy = "exclude";
      onsiteOnly = true;
      continue;
    }
    if (lower === "--profile" || lower.startsWith("--profile=")) {
      const value = lower.includes("=")
        ? lower.slice("--profile=".length)
        : nextValue()?.toLowerCase();
      if (
        value === "light" ||
        value === "standard" ||
        value === "deep" ||
        value === "exhaustive"
      ) {
        profile = value;
        continue;
      }
      throw new Error(
        `Invalid --profile value "${value ?? ""}". Expected light, standard, deep, or exhaustive.`,
      );
    }
    if (lower.startsWith("--sources=")) {
      const value = part.slice("--sources=".length).replace(/^["']|["']$/g, "");
      sourceNames.push(...value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
      continue;
    }
    if (lower.startsWith("--review-policy=")) {
      const value = part.slice("--review-policy=".length).replace(/^["']|["']$/g, "").toLowerCase();
      if (value === "broad" || value === "balanced" || value === "strict") {
        reviewPolicy = value;
        continue;
      }
      throw new Error(
        `Invalid --review-policy value "${value}". Expected broad, balanced, or strict.`,
      );
    }
    if (lower.startsWith("--")) {
      throw new Error(`Unknown discovery flag "${part}".`);
    }
    queryParts.push(part);
  }

  return {
    query: queryParts.join(" ").trim(),
    includeCustomSites,
    sourceNames: sourceNames.length > 0 ? [...new Set(sourceNames)] : undefined,
    reviewPolicy,
    profile,
    remotePolicy,
    onsiteOnly,
    dryRun,
    verbose,
  };
}

function maxResultsForProfile(profile: DiscoveryProfile | undefined): number | undefined {
  switch (profile) {
    case "light":
      return 50;
    case "standard":
      return 150;
    case "deep":
      return 300;
    case "exhaustive":
      return 500;
    default:
      return undefined;
  }
}

async function selectCustomSourcesForRun(
  flags: DiscoveryCommandFlags,
): Promise<{
  customSources: CustomSource[];
  builtInFromFlag?: SourceName[];
  explicitSourceFlag: boolean;
  warnings: string[];
}> {
  const fromFlag = flags.sourceNames;
  const warnings: string[] = [];
  const explicitSourceFlag = fromFlag !== undefined;
  const builtInFromFlag = fromFlag?.filter((source): source is SourceName =>
    BUILTIN_SOURCE_NAMES.has(source as SourceName),
  );
  const customSlugs = fromFlag?.filter((source) => !BUILTIN_SOURCE_NAMES.has(source as SourceName)) ?? [];
  const customSources: CustomSource[] = [];

  for (const slug of customSlugs) {
    const custom = await getCustomSource(slug).catch((error) => {
      warnings.push(error instanceof Error ? error.message : `Failed to load custom source ${slug}`);
      return null;
    });
    if (!custom) {
      warnings.push(`Custom source not found: ${slug}`);
      continue;
    }
    if (!custom.enabled) {
      warnings.push(`Skipped custom source ${custom.slug}: disabled`);
      continue;
    }
    customSources.push(custom);
  }

  if (flags.includeCustomSites) {
    const all = await listCustomSources({ enabledOnly: true }).catch((error) => {
      warnings.push(error instanceof Error ? error.message : "Failed to list custom sources");
      return [];
    });
    for (const custom of all) {
      if (customSources.some((existing) => existing.id === custom.id)) continue;
      customSources.push(custom);
    }
  }

  return {
    customSources,
    builtInFromFlag,
    explicitSourceFlag,
    warnings,
  };
}

function shouldUseAgentMode(
  dryRun: boolean,
  mode: DiscoveryRunMode,
): { useAgent: boolean; warning?: string } {
  if (mode === "deterministic") return { useAgent: false };
  const config = readLlmConfig();
  if (mode === "auto" && !config) return { useAgent: false };
  if (!config) {
    return {
      useAgent: false,
      warning: "LLM config missing; falling back to deterministic mode.",
    };
  }
  if (!dryRun && config.provider === "mock") {
    return {
      useAgent: false,
      warning:
        "Refusing to use mock LLM provider in live write mode; falling back to deterministic mode.",
    };
  }
  if (mode === "agent" || mode === "auto") return { useAgent: true };
  return { useAgent: false };
}

function attachSkippedSourceStats(
  summary: AgentRunSummary,
  skipped: Array<{ source: SourceName; reason: string }>,
): void {
  const existing = new Set(summary.sourceStats.map((stats) => stats.source));
  const skippedStats: SourceRunStats[] = skipped
    .filter((item) => !existing.has(item.source))
    .map((item) => ({
      source: item.source,
      leadsFound: 0,
      queueReady: 0,
      needsReview: 0,
      invalidRejected: 0,
      accepted: 0,
      rejected: 0,
      errors: [],
      warnings: [item.reason],
      durationMs: 0,
      outcome: /auth|connect|session|login|disconnected/i.test(item.reason)
        ? "auth_required"
        : "skipped",
    }));

  if (skippedStats.length === 0) return;
  summary.sourceStats = [...summary.sourceStats, ...skippedStats];
  summary.sourceAccounting = {
    executedSources: summary.sourceStats
      .filter((item) => item.outcome === "executed")
      .map((item) => item.source),
    skippedSources: summary.sourceStats
      .filter((item) => item.outcome === "skipped")
      .map((item) => item.source),
    failedSources: summary.sourceStats
      .filter((item) => item.outcome === "failed")
      .map((item) => item.source),
    degradedSources: summary.sourceStats
      .filter((item) => item.outcome === "degraded")
      .map((item) => item.source),
    authRequiredSources: summary.sourceStats
      .filter((item) => item.outcome === "auth_required")
      .map((item) => item.source),
  };
}

/**
 * Shared discovery application service used by CLI and web job runners.
 * Owns interpret → plan → collect → extract → verify → classify → dedupe → persist → summary.
 */
export async function runDiscovery(
  input: RunDiscoveryInput,
): Promise<DiscoveryRunResult> {
  const runId = input.runId ?? randomUUID();
  let dryRun = input.dryRun === true || input.dryRunPlan === true;
  const mode: DiscoveryRunMode = input.mode ?? "auto";
  const emitter = createEventEmitter(runId, input.eventSink);
  const performanceTracker = createDiscoveryPerformanceTracker({
    queueWaitMs: input.queueWaitMs,
    jobStartOverheadMs: input.jobStartOverheadMs,
  });

  let commandVerbose = input.verbose === true;
  const { hakku, plannerCommand, withCli, customSelection, commandFlags } =
    await performanceTracker.measure("commandParsing", async () => {
      const nextHakku = await getHakkuConnectionStatus();
      const nextCommandFlags = parseDiscoveryCommandFlags(input.command);
      dryRun = dryRun || nextCommandFlags.dryRun === true;
      commandVerbose = commandVerbose || nextCommandFlags.verbose === true;
      const nextPlannerCommand = nextCommandFlags.query || input.command;
      const parsed = parseCommand(nextPlannerCommand);
      const nextCustomSelection = await selectCustomSourcesForRun(nextCommandFlags);
      return {
        hakku: nextHakku,
        plannerCommand: nextPlannerCommand,
        customSelection: nextCustomSelection,
        commandFlags: nextCommandFlags,
        withCli: applyCliOptions(parsed, {
          sources: input.sources ?? nextCustomSelection.builtInFromFlag,
          maxResults: input.maxResults ?? maxResultsForProfile(nextCommandFlags.profile),
          reviewPolicy: input.reviewPolicy ?? nextCommandFlags.reviewPolicy,
          profile: nextCommandFlags.profile,
          remotePolicy: nextCommandFlags.remotePolicy,
          onsiteOnly: nextCommandFlags.onsiteOnly,
        }),
      };
    });

  const requestedSources: SourceName[] | undefined =
    input.sources && input.sources.length > 0
      ? input.sources
      : customSelection.explicitSourceFlag
        ? customSelection.builtInFromFlag ?? []
      : commandMentionsSources(plannerCommand)
        ? withCli.sources
        : undefined;

  const enabledFromSettings =
    input.enabledSources ?? (getEnabledSources() as SourceName[]);

  const selection = performanceTracker.measureSync("sourcePlan", () =>
    selectDiscoverySources({
      requestedSources,
      allSources: input.allSources,
      enabledSources: enabledFromSettings,
      availability: input.availability,
      hakkuConnected: hakku.connected,
      allowMock:
        input.allowMockWrites === true ||
        dryRun ||
        requestedSources?.includes("mock") === true,
    }),
  );

  let effectivePreferences: DiscoveryPreferences = {
    ...withCli,
    sources: selection.effectiveSources,
  };

  if (
    !hakku.connected &&
    (requestedSources?.includes("hakku") ||
      input.allSources ||
      input.enabledSources?.includes("hakku"))
  ) {
    await emitter.emit("source_auth_required", hakku.safeMessage, {
      source: "hakku",
      level: "warning",
    });
  }

  const plannedSourceLabels = [
    ...selection.effectiveSources,
    ...customSelection.customSources.map((source) => `custom:${source.slug}`),
  ];
  const plannedSourceDisplayLabels = [
    ...selection.effectiveSources,
    ...customSelection.customSources.map((source) => source.name || `custom:${source.slug}`),
  ];

  await emitter.emit(
    "run_started",
    plannedSourceLabels.length > 0
      ? `Sources: ${plannedSourceLabels.join(", ")}`
      : selection.planMessage,
    {
    metadata: {
      effectiveSources: selection.effectiveSources,
      customSources: customSelection.customSources.map((source) => source.slug),
      skipped: selection.skipped,
    },
  });

  const profile = effectivePreferences.profile ?? commandFlags.profile ?? "standard";
  const maxResults =
    effectivePreferences.maxResults ?? maxResultsForProfile(profile) ?? 150;
  const devpostBudget = devpostBudgetForProfile(profile, maxResults);
  const lumaBudget = lumaBudgetForProfile(profile, maxResults);
  const remoteLabel =
    effectivePreferences.remotePolicy === "only"
      ? "remote only"
      : effectivePreferences.remotePolicy === "exclude"
        ? "excluded"
        : effectivePreferences.remotePolicy === "inferred_open"
          ? "inferred open"
          : "included";
  await emitter.emit(
    "query_interpreted",
    [
      `Theme: ${effectivePreferences.themes.join(", ") || "unspecified"}`,
      `Location: ${
        effectivePreferences.locationConstraint === "event_location"
          ? effectivePreferences.locations.join(", ") || "unspecified"
          : effectivePreferences.locations.join(", ") || "none"
      }`,
      `Remote: ${remoteLabel}`,
      `Dates: ${
        effectivePreferences.dateFrom && effectivePreferences.dateTo
          ? `${effectivePreferences.dateFrom} – ${effectivePreferences.dateTo}`
          : "upcoming / inferred horizon"
      }`,
      `Profile: ${profile}`,
      `Dry-run: ${dryRun ? "yes" : "no"}`,
    ].join(" · "),
    {
      source: "query",
      metadata: {
        profile,
        dryRun,
        themes: effectivePreferences.themes,
        locations: effectivePreferences.locations,
        remotePolicy: effectivePreferences.remotePolicy,
        dateFrom: effectivePreferences.dateFrom ?? null,
        dateTo: effectivePreferences.dateTo ?? null,
        stageBudget: {
          profile,
          listingOwned: true,
          enrichmentTimeoutMs: stageBudgetForProfile(profile).enrichmentTimeoutMs,
          enrichmentMaxPages: stageBudgetForProfile(profile).enrichmentMaxPages,
        },
        sourceBudgets: {
          devpost: {
            target: devpostBudget.targetCards,
            max: devpostBudget.maxCards,
            pages: devpostBudget.maxPages,
            details: devpostBudget.detailLimit,
          },
          luma: {
            target: lumaBudget.targetEvents,
            max: lumaBudget.maxEvents,
            scrolls: lumaBudget.maxScrolls,
            details: lumaBudget.detailLimit,
          },
        },
      },
    },
  );
  await emitter.emit(
    "source_progress",
    `Devpost budget: target ${devpostBudget.targetCards} / max ${devpostBudget.maxCards} cards / ${devpostBudget.maxPages} pages / ${devpostBudget.detailLimit} details (stopAtTarget=${devpostBudget.stopAtTarget})`,
    { source: "query", metadata: { compact: true, budget: "devpost" } },
  );
  await emitter.emit(
    "source_progress",
    `Luma budget: target ${lumaBudget.targetEvents} / max ${lumaBudget.maxEvents} events / ${lumaBudget.maxScrolls} scrolls / ${lumaBudget.detailLimit} details`,
    { source: "query", metadata: { compact: true, budget: "luma" } },
  );

  await emitter.emit("source_progress", `Planned: ${plannedSourceLabels.join(", ") || "(none)"}`, {
    source: "sources",
    metadata: {
      plannedSources: selection.effectiveSources,
      customSources: customSelection.customSources.map((source) => source.slug),
    },
  });

  if (customSelection.explicitSourceFlag) {
    await emitter.emit(
      "source_progress",
      `Explicit selection: ${plannedSourceLabels.join(", ") || "(none)"}`,
      {
        source: "sources",
        metadata: {
          explicitSelection: plannedSourceLabels,
        },
      },
    );
  }

  for (const skipped of selection.skipped) {
    await emitter.emit("source_degraded", `Skipped - ${skipped.reason}`, {
      source: skipped.source,
      level: "warning",
      metadata: { outcome: "skipped", reason: skipped.reason },
    });
  }

  const warnings: string[] = [...selection.warnings];
  warnings.push(...customSelection.warnings);
  const agentMode = shouldUseAgentMode(dryRun, mode);
  if (agentMode.warning) warnings.push(agentMode.warning);

  const config = readLlmConfig();
  let agentToolCalls = 0;
  let agentLlmCalls = 0;
  let planningCalls = 0;
  let plannerLatencyMs: number | undefined;
  let plannerSucceeded = false;
  let tokenUsage:
    | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
    | undefined;
  let fallbackUsed = !agentMode.useAgent;
  let agentStopReason = agentMode.useAgent
    ? "deterministic handoff complete"
    : "deterministic fallback";

  try {
    if (input.cancellationSignal?.aborted) {
      throw Object.assign(new Error("Discovery run cancelled"), {
        name: "DiscoveryCancelledError",
      });
    }

    if (agentMode.useAgent || input.showAgentPlan || input.showAgentTrace) {
      await performanceTracker.measure("planning", async () => {
        await emitter.emit("planning_started", "Interpreting request…");

        const intent = parseIntent(plannerCommand);
        const plannerResult =
          agentMode.useAgent && intent.kind === "discover_hackathons"
            ? await planDiscoveryWithLlm(effectivePreferences, {
                dryRunCollectors: true,
                sourceTimeoutMs: input.sourceTimeoutMs,
                maxResults: input.maxResults,
              })
            : null;

        if (plannerResult) {
          const reconciledPlan = reconcileSourcePlan({
            effectiveSources: selection.effectiveSources,
            plannerSources: plannerResult.plan.selectedSources,
            plannerIntents: plannerResult.plan.sourceIntents.map((intent) => ({
              source: intent.source,
              enabled: intent.enabled,
              query: intent.query ?? undefined,
              reason: intent.reason,
            })),
            availabilityBySource: selection.availabilityBySource,
          });
          effectivePreferences = {
            ...plannerResult.preferences,
            sources: reconciledPlan.sources,
          };
          warnings.push(...reconciledPlan.warnings);
          agentLlmCalls = plannerResult.llmCalls;
          planningCalls = plannerResult.planningCalls;
          plannerLatencyMs = plannerResult.latencyMs;
          plannerSucceeded = !plannerResult.fallbackUsed;
          tokenUsage = plannerResult.usage;
          fallbackUsed = plannerResult.fallbackUsed;
          if (plannerResult.warning) warnings.push(plannerResult.warning);
          warnings.push(...plannerResult.plan.warnings);
        }

        const deterministicPlan = plannerResult
          ? {
              id: `llm-${intent.rawCommand
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")
                .slice(0, 40) || "command"}`,
              summary: `LLM plan discovery across ${
                plannedSourceDisplayLabels.join(", ") || "(none)"
              }.`,
              warnings: plannerResult.plan.warnings,
              toolCalls: plannerResult.toolCalls,
            }
          : planDiscovery(intent, {
              dryRunPlan: true,
              dryRunCollectors: true,
              sourceTimeoutMs: input.sourceTimeoutMs,
              maxResults: input.maxResults,
            });

        const planningSummary =
          plannedSourceDisplayLabels.length > 0
            ? `Planning discovery across ${plannedSourceDisplayLabels.join(", ")}.`
            : deterministicPlan.summary;

        await emitter.emit("planning_completed", planningSummary, {
          metadata: {
            planId: deterministicPlan.id,
            sources: [
              ...effectivePreferences.sources,
              ...customSelection.customSources.map((source) => `custom:${source.slug}`),
            ],
            toolCalls: deterministicPlan.toolCalls.map((call) => call.name),
          },
        });

        await emitter.emit(
          "source_progress",
          `Planned: ${[
            ...effectivePreferences.sources,
            ...customSelection.customSources.map((source) => `custom:${source.slug}`),
          ].join(", ")}`,
          {
            source: "sources",
            metadata: {
              plannedSources: effectivePreferences.sources,
              customSources: customSelection.customSources.map((source) => source.slug),
            },
          },
        );

        const loop = await runLoop({
          plan: {
            id: deterministicPlan.id,
            description: deterministicPlan.summary,
            toolCalls: deterministicPlan.toolCalls.map((call) => ({
              id: call.id,
              name: call.name,
              args: call.args ?? {},
            })),
          },
          limits: {
            maxLoops: 3,
            maxToolCalls: input.maxAgentCalls ?? 12,
            maxElapsedMs: 10_000,
            perToolTimeoutMs: 5_000,
          },
        });

        if (input.showAgentTrace && input.eventSink) {
          for (const event of loop.runtime.trace) {
            await emitter.emit(
              "source_progress",
              `#${event.sequence} ${event.type}${event.toolName ? ` ${event.toolName}` : ""}${event.message ? `: ${event.message}` : ""}`,
              { metadata: { agentTrace: true } },
            );
          }
        }

        if (loop.stopReason) warnings.push(`Agent planning stopped: ${loop.stopReason}`);
        agentToolCalls = loop.runtime.toolCallCount;
        agentStopReason =
          loop.stopReason ??
          (plannerResult ? plannerResult.plan.stopReason : agentStopReason);
      });
    }

    const agentObservability: AgentRunSummary["agent"] = {
      mode: agentMode.useAgent ? "AGENT" : "DETERMINISTIC",
      provider: config?.provider,
      model: config?.model,
      llmCalls: agentLlmCalls,
      planningCalls,
      extractionCalls: 0,
      verificationCalls: 0,
      summaryCalls: 0,
      plannerLatencyMs,
      plannerSucceeded,
      tokenUsage,
      toolCalls: agentToolCalls,
      sourcesSelected: effectivePreferences.sources,
      stopReason: agentStopReason,
      fallbackUsed,
      warnings,
    };

    const pipelineOptions: DiscoveryPipelineOptions = {
      allowMockWrites: input.allowMockWrites,
      sourceTimeoutMs: input.sourceTimeoutMs,
      totalTimeoutMs: input.totalTimeoutMs,
      showSearchPlan: input.showSearchPlan,
      showXPlan: input.showXPlan,
      dryRunPlan: input.dryRunPlan,
      verbose: commandVerbose,
      agentObservability,
      runId,
      eventSink: input.eventSink,
      cancellationSignal: input.cancellationSignal,
      emitPlansAsEvents: Boolean(input.eventSink),
      customSources: customSelection.customSources,
      performanceTracker,
      onAcceptedWriteSet: input.onAcceptedWriteSet,
    };

    const summary = await executeDiscoveryPipeline(
      effectivePreferences,
      dryRun,
      pipelineOptions,
    );
    attachSkippedSourceStats(summary, selection.skipped);
    summary.agent = agentObservability;
    summary.warnings = [...new Set([...warnings, ...summary.warnings])];

    return {
      runId,
      summary,
      effectiveSources: plannedSourceLabels as DiscoverySourceId[],
      skippedSources: selection.skipped,
      cancelled: false,
    };
  } catch (error) {
    if (isDiscoveryCancelledError(error)) {
      return {
        runId,
        summary: emptyCancelledSummary(
          input.command,
          effectivePreferences,
          dryRun,
          warnings,
          performanceTracker.finalize(),
        ),
        effectiveSources: plannedSourceLabels as DiscoverySourceId[],
        skippedSources: selection.skipped,
        cancelled: true,
      };
    }
    throw error;
  }
}

function emptyCancelledSummary(
  command: string,
  preferences: DiscoveryPreferences,
  dryRun: boolean,
  warnings: string[],
  performance?: AgentRunSummary["performance"],
): AgentRunSummary {
  return {
    rawCommand: command,
    preferences,
    dryRun,
    verbose: false,
    rawLeads: 0,
    uniqueLeads: 0,
    crossSourceMerges: 0,
    enriched: 0,
    extracted: 0,
    accepted: 0,
    rejected: 0,
    created: 0,
    updated: 0,
    wouldCreate: 0,
    wouldUpdate: 0,
    evidenceWritten: 0,
    wouldAttachEvidence: 0,
    storageFailures: 0,
    stored: 0,
    duplicatesUpdated: 0,
    needsReview: 0,
    durationMs: 0,
    quality: emptyQualityStats(),
    acceptedCandidates: [],
    rejectedCandidates: [],
    sourceStats: [],
    sourceAccounting: {
      executedSources: [],
      skippedSources: [],
      failedSources: [],
      degradedSources: [],
      authRequiredSources: [],
    },
    performance,
    warnings,
    errors: ["Discovery run cancelled"],
  };
}
