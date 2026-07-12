import { applyCliOptions, parseCommand } from "@/agent/parseCommand";
import { runDiscovery } from "@/agent/controller";
import { parseIntent } from "@/agent/llm/parseIntent";
import { planDiscovery } from "@/agent/llm/planDiscovery";
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

function printAgentPlan(plan: ReturnType<typeof planDiscovery>): void {
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

  if (agentMode.useAgent || cliOptions.showAgentPlan || cliOptions.showAgentTrace) {
    const intent = parseIntent(rawCommand);
    const plan = planDiscovery(intent, {
      dryRunPlan: true,
      dryRunCollectors: true,
      sourceTimeoutMs: cliOptions.sourceTimeoutMs,
      maxResults: cliOptions.maxResults,
    });

    if (cliOptions.showAgentPlan) {
      printAgentPlan(plan);
    }

    const loop = await runLoop({
      plan: {
        id: plan.id,
        description: plan.summary,
        toolCalls: plan.toolCalls.map((call) => ({
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
  }

  const summary = await runDiscovery(preferences, dryRun || Boolean(cliOptions.dryRunPlan), {
    allowMockWrites: cliOptions.allowMockWrites,
    sourceTimeoutMs: cliOptions.sourceTimeoutMs,
    totalTimeoutMs: cliOptions.totalTimeoutMs,
    showSearchPlan: cliOptions.showSearchPlan,
    showXPlan: cliOptions.showXPlan,
    dryRunPlan: cliOptions.dryRunPlan,
    verbose: cliOptions.verbose,
  });
  summary.agent = {
    mode: agentMode.useAgent ? "AGENT" : "DETERMINISTIC",
    provider: readLlmConfig()?.provider,
    model: readLlmConfig()?.model,
    llmCalls: 0,
    toolCalls: 0,
    sourcesSelected: preferences.sources,
    stopReason: agentMode.useAgent ? "deterministic handoff complete" : "deterministic fallback",
    fallbackUsed: !agentMode.useAgent,
    warnings,
  };
  summary.warnings.push(...warnings);
  printAgentSummary(summary);
}
