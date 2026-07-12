import { AGENT_TOOL_NAMES } from "@/agent/runtime/tools";
import { planSearchQueries } from "@/agent/planSearchQueries";
import type { SourceName } from "@/core/discovery/types";
import { discoveryPlanSchema, type AgentIntent, type DiscoveryPlan } from "./schemas";

export type PlanDiscoveryOptions = {
  dryRunPlan?: boolean;
  includeParseTool?: boolean;
  dryRunCollectors?: boolean;
  requestId?: string;
  sourceTimeoutMs?: number;
  maxResults?: number;
};

const SOURCE_TO_TOOL: Record<SourceName, string> = {
  hacklist: AGENT_TOOL_NAMES.collectHacklist,
  mlh: AGENT_TOOL_NAMES.collectMlh,
  luma: AGENT_TOOL_NAMES.collectLuma,
  devpost: AGENT_TOOL_NAMES.collectDevpost,
  hakku: AGENT_TOOL_NAMES.collectHakku,
  web: AGENT_TOOL_NAMES.collectWeb,
  x: AGENT_TOOL_NAMES.collectX,
  mock: AGENT_TOOL_NAMES.finalizeDiscoveryPlan,
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

  const searchQueries = planSearchQueries(intent.preferences).slice(0, 6);

  if (!options.dryRunPlan) {
    for (const source of intent.preferences.sources) {
      if (source === "mock") continue;
      toolCalls.push({
        id: `collect-${source}`,
        name: SOURCE_TO_TOOL[source],
        args: {
          preferences: intent.preferences,
          dryRun: options.dryRunCollectors ?? true,
          requestId: options.requestId,
          timeoutMs: options.sourceTimeoutMs,
          maxResults: options.maxResults,
        },
        reason: `Run ${source} only if selected by the bounded discovery plan.`,
      });
    }
  }

  toolCalls.push({
    id: "finalize-plan",
    name: AGENT_TOOL_NAMES.finalizeDiscoveryPlan,
    args: {
      selectedSources: intent.preferences.sources,
      searchQueries,
      stopReason: options.dryRunPlan ? "plan-only" : "selected sources exhausted",
      warnings: intent.warnings,
    },
    reason: "Record the selected sources and stop condition.",
  });

  return discoveryPlanSchema.parse({
    id: planId(intent.rawCommand),
    intent,
    summary: `Plan discovery across ${intent.preferences.sources.join(", ")}.`,
    toolCalls,
    warnings: intent.warnings,
  });
}
