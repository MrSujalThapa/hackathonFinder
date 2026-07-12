import { applyCliOptions, parseCommand } from "@/agent/parseCommand";
import { runDiscovery } from "@/agent/controller";
import { parseIntent } from "@/agent/llm/parseIntent";
import { planDiscovery } from "@/agent/llm/planDiscovery";
import { planDiscoveryWithLlm } from "@/agent/llm/planWithLlm";
import { runLoop } from "@/agent/runtime/runLoop";
import { printAgentSummary } from "@/agent/summary";
import type { SourceName } from "@/core/discovery/types";
import { readLlmConfig } from "@/lib/llm/config";

export type RunAgentOptions = {
  sources?: SourceName[];
  maxResults?: number;
  allowMockWrites?: boolean;
  sourceTimeoutMs?: number;
  totalTimeoutMs?: number;
  showSearchPlan?: boolean;
  showXPlan?: boolean;
  agent?: boolean;
  deterministic?: boolean;
  showAgentPlan?: boolean;
  showAgentTrace?: boolean;
  maxAgentCalls?: number;
  dryRunPlan?: boolean;
  verbose?: boolean;
};

function printAgentPlan(plan: {
  id: string;
  summary: string;
  warnings: string[];
  toolCalls: Array<{ name: string; reason?: string }>;
}): void {
  console.log("Agent plan:");
  console.log(`- id: ${plan.id}`);
  console.log(`- summary: ${plan.summary}`);
  for (const call of plan.toolCalls) {
    console.log(`- ${call.name}: ${call.reason ?? "planned"}`);
  }
  if (plan.warnings.length > 0) {
    console.log("- warnings:");
    for (const warning of plan.warnings) console.log(`  - ${warning}`);
  }
  console.log("");
}

function shouldUseAgentMode(dryRun: boolean, options: RunAgentOptions): { useAgent: boolean; warning?: string } {
  if (options.deterministic) return { useAgent: false };
  const config = readLlmConfig();
  if (!options.agent && !config) return { useAgent: false };
  if (!config) {
    return { useAgent: false, warning: "LLM config missing; falling back to deterministic mode." };
  }
  if (!dryRun && config.provider === "mock") {
    return {
      useAgent: false,
      warning: "Refusing to use mock LLM provider in live write mode; falling back to deterministic mode.",
    };
  }
  return { useAgent: true };
}

export async function runAgent(
  rawCommand: string,
  dryRun: boolean,
  cliOptions: RunAgentOptions = {},
): Promise<void> {
  const parsed = parseCommand(rawCommand);
  const preferences = applyCliOptions(parsed, cliOptions);
  const agentMode = shouldUseAgentMode(dryRun || Boolean(cliOptions.dryRunPlan), cliOptions);
  const warnings: string[] = [];
  if (agentMode.warning) warnings.push(agentMode.warning);
  const config = readLlmConfig();
  let effectivePreferences = preferences;
  let agentToolCalls = 0;
  let agentLlmCalls = 0;
  let planningCalls = 0;
  let plannerLatencyMs: number | undefined;
  let plannerSucceeded = false;
  let tokenUsage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
  let fallbackUsed = !agentMode.useAgent;
  let agentStopReason = agentMode.useAgent ? "deterministic handoff complete" : "deterministic fallback";

  if (agentMode.useAgent || cliOptions.showAgentPlan || cliOptions.showAgentTrace) {
    const intent = parseIntent(rawCommand);
    const plannerResult = agentMode.useAgent && intent.kind === "discover_hackathons"
      ? await planDiscoveryWithLlm(preferences, {
          dryRunCollectors: true,
          sourceTimeoutMs: cliOptions.sourceTimeoutMs,
          maxResults: cliOptions.maxResults,
        })
      : null;
    if (plannerResult) {
      effectivePreferences = plannerResult.preferences;
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
          id: `llm-${intent.rawCommand.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "command"}`,
          summary: `LLM plan discovery across ${plannerResult.plan.selectedSources.join(", ")}.`,
          warnings: plannerResult.plan.warnings,
          toolCalls: plannerResult.toolCalls,
        }
      : planDiscovery(intent, {
          dryRunPlan: true,
          dryRunCollectors: true,
          sourceTimeoutMs: cliOptions.sourceTimeoutMs,
          maxResults: cliOptions.maxResults,
        });

    if (cliOptions.showAgentPlan) {
      printAgentPlan(deterministicPlan);
    }

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
        maxToolCalls: cliOptions.maxAgentCalls ?? 12,
        maxElapsedMs: 10_000,
        perToolTimeoutMs: 5_000,
      },
    });

    if (cliOptions.showAgentTrace) {
      console.log("Agent trace:");
      for (const event of loop.runtime.trace) {
        console.log(`- #${event.sequence} ${event.type}${event.toolName ? ` ${event.toolName}` : ""}${event.message ? `: ${event.message}` : ""}`);
      }
      console.log("");
    }

    if (loop.stopReason) warnings.push(`Agent planning stopped: ${loop.stopReason}`);
    agentToolCalls = loop.runtime.toolCallCount;
    agentStopReason = loop.stopReason ?? (plannerResult ? plannerResult.plan.stopReason : agentStopReason);
  }

  const agentObservability = {
    mode: agentMode.useAgent ? "AGENT" as const : "DETERMINISTIC" as const,
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

  const summary = await runDiscovery(effectivePreferences, dryRun || Boolean(cliOptions.dryRunPlan), {
    allowMockWrites: cliOptions.allowMockWrites,
    sourceTimeoutMs: cliOptions.sourceTimeoutMs,
    totalTimeoutMs: cliOptions.totalTimeoutMs,
    showSearchPlan: cliOptions.showSearchPlan,
    showXPlan: cliOptions.showXPlan,
    dryRunPlan: cliOptions.dryRunPlan,
    verbose: cliOptions.verbose,
    agentObservability,
  });
  summary.agent = agentObservability;
  summary.warnings.push(...warnings);
  printAgentSummary(summary);
}
