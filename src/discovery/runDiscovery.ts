import { randomUUID } from "node:crypto";
import { applyCliOptions, parseCommand } from "@/agent/parseCommand";
import { parseIntent } from "@/agent/llm/parseIntent";
import { planDiscovery } from "@/agent/llm/planDiscovery";
import { planDiscoveryWithLlm } from "@/agent/llm/planWithLlm";
import { runLoop } from "@/agent/runtime/runLoop";
import type {
  AgentRunSummary,
  DiscoveryPreferences,
  SourceName,
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
import { emptyQualityStats } from "@/agent/summary";
import { getEnabledSources } from "@/lib/sources/settingsStore";

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
  showAgentPlan?: boolean;
  showAgentTrace?: boolean;
  runId?: string;
};

export type DiscoveryRunResult = {
  runId: string;
  summary: AgentRunSummary;
  effectiveSources: SourceName[];
  skippedSources: Array<{ source: SourceName; reason: string }>;
  cancelled: boolean;
};

function commandMentionsSources(command: string): boolean {
  return /\b(hacklist|hakku|devpost|mlh|luma|web|mock|twitter|x)\b/i.test(command);
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

/**
 * Shared discovery application service used by CLI and web job runners.
 * Owns interpret → plan → collect → extract → verify → classify → dedupe → persist → summary.
 */
export async function runDiscovery(
  input: RunDiscoveryInput,
): Promise<DiscoveryRunResult> {
  const runId = input.runId ?? randomUUID();
  const dryRun = input.dryRun === true || input.dryRunPlan === true;
  const mode: DiscoveryRunMode = input.mode ?? "auto";
  const emitter = createEventEmitter(runId, input.eventSink);

  const hakku = await getHakkuConnectionStatus();
  const parsed = parseCommand(input.command);
  const withCli = applyCliOptions(parsed, {
    sources: input.sources,
    maxResults: input.maxResults,
  });

  const requestedSources: SourceName[] | undefined =
    input.sources && input.sources.length > 0
      ? input.sources
      : commandMentionsSources(input.command)
        ? withCli.sources
        : undefined;

  const enabledFromSettings =
    input.enabledSources ?? (getEnabledSources() as SourceName[]);

  const selection = selectDiscoverySources({
    requestedSources,
    allSources: input.allSources,
    enabledSources: enabledFromSettings,
    availability: input.availability,
    hakkuConnected: hakku.connected,
    allowMock:
      input.allowMockWrites === true ||
      dryRun ||
      requestedSources?.includes("mock") === true,
  });

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

  await emitter.emit("run_started", selection.planMessage, {
    metadata: {
      effectiveSources: selection.effectiveSources,
      skipped: selection.skipped,
    },
  });

  const warnings: string[] = [...selection.warnings];
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
      await emitter.emit("planning_started", "Interpreting request…");

      const intent = parseIntent(input.command);
      const plannerResult =
        agentMode.useAgent && intent.kind === "discover_hackathons"
          ? await planDiscoveryWithLlm(effectivePreferences, {
              dryRunCollectors: true,
              sourceTimeoutMs: input.sourceTimeoutMs,
              maxResults: input.maxResults,
            })
          : null;

      if (plannerResult) {
        const plannedSelection = selectDiscoverySources({
          requestedSources: plannerResult.preferences.sources,
          enabledSources: enabledFromSettings,
          availability: input.availability,
          hakkuConnected: hakku.connected,
          allowMock:
            input.allowMockWrites === true ||
            dryRun ||
            plannerResult.preferences.sources.includes("mock"),
        });
        effectivePreferences = {
          ...plannerResult.preferences,
          sources:
            plannedSelection.effectiveSources.length > 0
              ? plannedSelection.effectiveSources
              : plannerResult.preferences.sources.filter((source) => source !== "x"),
        };
        warnings.push(...plannedSelection.warnings);
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
            summary: `LLM plan discovery across ${effectivePreferences.sources.join(", ")}.`,
            warnings: plannerResult.plan.warnings,
            toolCalls: plannerResult.toolCalls,
          }
        : planDiscovery(intent, {
            dryRunPlan: true,
            dryRunCollectors: true,
            sourceTimeoutMs: input.sourceTimeoutMs,
            maxResults: input.maxResults,
          });

      await emitter.emit("planning_completed", deterministicPlan.summary, {
        metadata: {
          planId: deterministicPlan.id,
          sources: effectivePreferences.sources,
          toolCalls: deterministicPlan.toolCalls.map((call) => call.name),
        },
      });

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
      verbose: input.verbose,
      agentObservability,
      runId,
      eventSink: input.eventSink,
      cancellationSignal: input.cancellationSignal,
      emitPlansAsEvents: Boolean(input.eventSink),
    };

    const summary = await executeDiscoveryPipeline(
      effectivePreferences,
      dryRun,
      pipelineOptions,
    );
    summary.agent = agentObservability;
    summary.warnings = [...new Set([...warnings, ...summary.warnings])];

    return {
      runId,
      summary,
      effectiveSources: effectivePreferences.sources,
      skippedSources: selection.skipped,
      cancelled: false,
    };
  } catch (error) {
    if (isDiscoveryCancelledError(error)) {
      return {
        runId,
        summary: emptyCancelledSummary(input.command, effectivePreferences, dryRun, warnings),
        effectiveSources: effectivePreferences.sources,
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
    warnings,
    errors: ["Discovery run cancelled"],
  };
}
