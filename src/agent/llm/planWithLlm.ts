import { z } from "zod";
import { planSearchQueries } from "@/agent/planSearchQueries";
import { AGENT_TOOL_NAMES } from "@/agent/runtime/tools";
import type { DiscoveryPreferences, SourceName } from "@/core/discovery/types";
import { createLlmProvider, type CreateLlmProviderOptions } from "@/lib/llm/createProvider";
import { LlmError } from "@/lib/llm/errors";
import { generateJson, jsonSchemaResponseFormat } from "@/lib/llm/structured";
import type { LlmProvider, LlmUsage } from "@/lib/llm/types";

const sourceNameSchema = z.enum(["hacklist", "hakku", "devpost", "mlh", "luma", "web", "x", "mock"]);

export const llmDiscoveryPlanSchema = z.object({
  selectedSources: z.array(sourceNameSchema),
  searchQueries: z.array(z.string().min(1)).max(8).default([]),
  verificationGoals: z.array(z.string().min(1)).max(8).default([]),
  needsEnrichment: z.boolean().default(false),
  stopReason: z.string().min(1).default("planner completed"),
  warnings: z.array(z.string()).default([]),
});

export type LlmDiscoveryPlan = z.infer<typeof llmDiscoveryPlanSchema>;

export type LlmPlannerResult = {
  plan: LlmDiscoveryPlan;
  preferences: DiscoveryPreferences;
  toolCalls: Array<{
    id: string;
    name: string;
    args: unknown;
    reason?: string;
  }>;
  llmCalls: number;
  planningCalls: number;
  latencyMs: number;
  usage?: LlmUsage;
  fallbackUsed: boolean;
  warning?: string;
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

function jsonSchemaForPlanner(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "selectedSources",
      "searchQueries",
      "verificationGoals",
      "needsEnrichment",
      "stopReason",
      "warnings",
    ],
    properties: {
      selectedSources: {
        type: "array",
        items: { enum: ["hacklist", "hakku", "devpost", "mlh", "luma", "web", "x", "mock"] },
      },
      searchQueries: { type: "array", items: { type: "string" }, maxItems: 8 },
      verificationGoals: { type: "array", items: { type: "string" }, maxItems: 8 },
      needsEnrichment: { type: "boolean" },
      stopReason: { type: "string" },
      warnings: { type: "array", items: { type: "string" } },
    },
  };
}

function fallbackPlan(preferences: DiscoveryPreferences, reason: string): LlmDiscoveryPlan {
  return {
    selectedSources: preferences.sources,
    searchQueries: planSearchQueries(preferences).slice(0, 6),
    verificationGoals: [
      "verify individual event identity",
      "verify date or deadline",
      "verify apply or official URL",
    ],
    needsEnrichment: true,
    stopReason: reason,
    warnings: [reason],
  };
}

function mergePlannerOutput(
  preferences: DiscoveryPreferences,
  plan: LlmDiscoveryPlan,
): { plan: LlmDiscoveryPlan; preferences: DiscoveryPreferences } {
  const allowed = new Set(preferences.sources);
  const selected = plan.selectedSources.filter((source) => allowed.has(source));
  const selectedSources = selected.length > 0 ? [...new Set(selected)] : preferences.sources;
  const searchQueries =
    plan.searchQueries.length > 0 ? plan.searchQueries.slice(0, 8) : planSearchQueries(preferences).slice(0, 6);

  return {
    plan: {
      ...plan,
      selectedSources,
      searchQueries,
      warnings: [
        ...plan.warnings,
        ...plan.selectedSources
          .filter((source) => !allowed.has(source))
          .map((source) => `Planner-selected source ${source} was ignored because it was not explicitly allowed.`),
      ],
    },
    preferences: {
      ...preferences,
      sources: selectedSources,
    },
  };
}

function toolCallsForPlan(
  preferences: DiscoveryPreferences,
  plan: LlmDiscoveryPlan,
  options: { dryRunCollectors?: boolean; sourceTimeoutMs?: number; maxResults?: number },
): LlmPlannerResult["toolCalls"] {
  return [
    ...plan.selectedSources
      .filter((source) => source !== "mock")
      .map((source) => ({
        id: `collect-${source}`,
        name: SOURCE_TO_TOOL[source],
        args: {
          preferences,
          dryRun: options.dryRunCollectors ?? true,
          timeoutMs: options.sourceTimeoutMs,
          maxResults: options.maxResults,
        },
        reason: `LLM planner selected ${source}.`,
      })),
    {
      id: "finalize-plan",
      name: AGENT_TOOL_NAMES.finalizeDiscoveryPlan,
      args: {
        selectedSources: plan.selectedSources,
        searchQueries: plan.searchQueries,
        stopReason: plan.stopReason,
        warnings: plan.warnings,
      },
      reason: "Record LLM planner output and stop condition.",
    },
  ];
}

export async function planDiscoveryWithLlm(
  preferences: DiscoveryPreferences,
  options: {
    provider?: LlmProvider;
    providerOptions?: CreateLlmProviderOptions;
    dryRunCollectors?: boolean;
    sourceTimeoutMs?: number;
    maxResults?: number;
  } = {},
): Promise<LlmPlannerResult> {
  const startedAt = Date.now();
  let rawPlan: LlmDiscoveryPlan;
  let usage: LlmUsage | undefined;

  try {
    const provider = options.provider ?? createLlmProvider({
      timeoutMs: 12_000,
      retries: 1,
      maxOutputTokens: 700,
      ...options.providerOptions,
    });

    const result = await generateJson(
      provider,
      {
        messages: [
          {
            role: "system",
            content:
              "You plan read-only hackathon discovery. Return only JSON. Do not invent tools. Choose only supplied sources. Keep the plan small and verification-focused.",
          },
          {
            role: "user",
            content: JSON.stringify({
              command: preferences.rawCommand,
              explicitSources: preferences.sources,
              locations: preferences.locations,
              themes: preferences.themes,
              modes: preferences.modes,
              dateFrom: preferences.dateFrom,
              dateTo: preferences.dateTo,
              maxResults: preferences.maxResults,
            }),
          },
        ],
        temperature: 0,
        maxOutputTokens: 700,
        responseFormat: jsonSchemaResponseFormat({
          name: "discovery_plan",
          schema: jsonSchemaForPlanner(),
        }),
      },
      (value) => llmDiscoveryPlanSchema.parse(value),
    );
    rawPlan = result.value;
    usage = result.response.usage;
  } catch (error) {
    const category = error instanceof LlmError ? error.category : "unknown";
    const message = error instanceof Error ? error.message : "LLM planning failed";
    const plan = fallbackPlan(preferences, `LLM planner fallback (${category}): ${message}`);
    return {
      plan,
      preferences,
      toolCalls: toolCallsForPlan(preferences, plan, options),
      llmCalls: 1,
      planningCalls: 1,
      latencyMs: Date.now() - startedAt,
      fallbackUsed: true,
      warning: plan.warnings[0],
    };
  }

  const merged = mergePlannerOutput(preferences, rawPlan);
  return {
    plan: merged.plan,
    preferences: merged.preferences,
    toolCalls: toolCallsForPlan(merged.preferences, merged.plan, options),
    llmCalls: 1,
    planningCalls: 1,
    latencyMs: Date.now() - startedAt,
    usage,
    fallbackUsed: false,
  };
}
