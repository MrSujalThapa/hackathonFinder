import { AGENT_TOOL_NAMES } from "@/agent/runtime/tools";
import { discoveryPlanSchema, type AgentIntent, type DiscoveryPlan } from "./schemas";

export type PlanDiscoveryOptions = {
  dryRunPlan?: boolean;
  includeParseTool?: boolean;
  dryRunCollectors?: boolean;
  requestId?: string;
  sourceTimeoutMs?: number;
  maxResults?: number;
};

function planId(rawCommand: string): string {
  const slug = rawCommand
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `discovery-${slug || "command"}`;
}

export function planDiscovery(
  intent: AgentIntent,
  options: PlanDiscoveryOptions = {},
): DiscoveryPlan {
  if (intent.kind !== "discover_hackathons") {
    return discoveryPlanSchema.parse({
      id: planId(intent.rawCommand),
      intent,
      summary: "No discovery plan was created for an unknown intent.",
      toolCalls: [],
      warnings: intent.warnings,
    });
  }

  const toolCalls = [];

  if (options.includeParseTool) {
    toolCalls.push({
      id: "parse-intent",
      name: AGENT_TOOL_NAMES.parseDiscoveryIntent,
      args: { command: intent.rawCommand },
      reason: "Capture deterministic discovery preferences.",
    });
  }

  toolCalls.push({
    id: "plan-web-search",
    name: AGENT_TOOL_NAMES.planSearchQueries,
    args: { preferences: intent.preferences },
    reason: "Inspect deterministic web search queries before collection.",
  });

  if (intent.preferences.sources.includes("x")) {
    toolCalls.push({
      id: "plan-x-search",
      name: AGENT_TOOL_NAMES.planXQueries,
      args: { preferences: intent.preferences },
      reason: "Inspect deterministic X search queries before collection.",
    });
  }

  if (!options.dryRunPlan) {
    toolCalls.push({
      id: "collect-sources",
      name: AGENT_TOOL_NAMES.collectSources,
      args: {
        preferences: intent.preferences,
        dryRun: options.dryRunCollectors ?? true,
        requestId: options.requestId,
        timeoutMs: options.sourceTimeoutMs,
        maxResults: options.maxResults,
      },
      reason: "Run the selected registered collectors under runtime limits.",
    });
  }

  return discoveryPlanSchema.parse({
    id: planId(intent.rawCommand),
    intent,
    summary: `Plan discovery across ${intent.preferences.sources.join(", ")}.`,
    toolCalls,
    warnings: intent.warnings,
  });
}
