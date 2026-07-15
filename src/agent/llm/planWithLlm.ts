import { z } from "zod";
import { planSearchQueries } from "@/agent/planSearchQueries";
import { AGENT_TOOL_NAMES } from "@/agent/runtime/tools";
import type { DiscoveryPreferences, SourceName } from "@/core/discovery/types";
import {
  reconcileSourcePlan,
  type PlannerSourceIntent,
} from "@/discovery/sourcePlan";
import { createLlmProvider, type CreateLlmProviderOptions } from "@/lib/llm/createProvider";
import { LlmError } from "@/lib/llm/errors";
import { generateJson, jsonSchemaResponseFormat } from "@/lib/llm/structured";
import type { LlmProvider, LlmUsage } from "@/lib/llm/types";

const sourceNameSchema = z.enum(["hacklist", "hakku", "devpost", "mlh", "luma", "web", "x", "mock"]);

const sourceIntentSchema = z.object({
  source: sourceNameSchema,
  enabled: z.boolean(),
  query: z.string().min(1).nullable().optional(),
  reason: z.string().min(1),
});

export const llmDiscoveryPlanSchema = z.object({
  selectedSources: z.array(sourceNameSchema),
  sourceIntents: z.array(sourceIntentSchema).default([]),
  searchQueries: z.array(z.string().min(1)).max(8).default([]),
  verificationGoals: z.array(z.string().min(1)).max(8).default([]),
  needsEnrichment: z.boolean().default(false),
  stopReason: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().min(1).default("planner completed"),
  ),
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

function jsonSchemaForPlanner(sources: SourceName[]): Record<string, unknown> {
  const allowedSources = sources.length > 0 ? sources : ["web"];
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "selectedSources",
      "sourceIntents",
      "searchQueries",
      "verificationGoals",
      "needsEnrichment",
      "stopReason",
      "warnings",
    ],
    properties: {
      selectedSources: {
        type: "array",
        items: { enum: allowedSources },
      },
      sourceIntents: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["source", "enabled", "query", "reason"],
          properties: {
            source: {
              enum: allowedSources,
            },
            enabled: { type: "boolean" },
            query: { type: ["string", "null"] },
            reason: { type: "string" },
          },
        },
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
    sourceIntents: preferences.sources.map((source) => ({
      source,
      enabled: true,
      reason: "Fallback plan preserves every effective source.",
    })),
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
  const reconciled = reconcileSourcePlan({
    effectiveSources: preferences.sources,
    plannerSources: plan.selectedSources,
    plannerIntents: plan.sourceIntents.map((intent): PlannerSourceIntent => ({
      source: intent.source,
      enabled: intent.enabled,
      query: intent.query ?? undefined,
      reason: intent.reason,
    })),
  });
  const selectedSources = reconciled.sources;
  const searchQueries =
    plan.searchQueries.length > 0 ? plan.searchQueries.slice(0, 8) : planSearchQueries(preferences).slice(0, 6);

  return {
    plan: {
      ...plan,
      selectedSources,
      sourceIntents: reconciled.items.map((item) => ({
        source: item.source,
        enabled: item.state === "execute",
        query: item.query ?? null,
        reason:
          item.reason ??
          (item.state === "execute"
            ? "Effective source selected for execution."
            : `Source ${item.state.replace(/^skip_/, "").replace(/_/g, " ")}.`),
      })),
      searchQueries,
      warnings: [
        ...plan.warnings,
        ...plan.selectedSources
          .filter((source) => !allowed.has(source))
          .map((source) => `Planner-selected source ${source} was ignored because it was not explicitly allowed.`),
        ...reconciled.warnings,
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
        sourceIntents: plan.sourceIntents,
        searchQueries: plan.searchQueries,
        stopReason: plan.stopReason,
        warnings: plan.warnings,
      },
      reason: "Record LLM planner output and stop condition.",
    },
  ];
}

function sourceCapabilitiesForPrompt(sources: SourceName[]): Record<string, string[]> {
  const capabilities: Partial<Record<SourceName, string[]>> = {
    mlh: ["public", "no auth", "HTTP/public collector"],
    web: ["public", "search-provider dependent"],
    hacklist: ["public", "native collector"],
    devpost: ["public", "Playwright rendered listings", "may be degraded"],
    luma: ["public mode available", "no login required for public discovery"],
    hakku: [
      "authenticated persistent browser source",
      "use only when connected and usable",
      "directory URL: https://www.hakku.app/explore",
    ],
    mock: ["local fixture source", "use only when explicitly supplied"],
    x: ["not included by default", "use only when explicitly supplied"],
  };

  return Object.fromEntries(
    sources.map((source) => [source, capabilities[source] ?? ["configured source"]]),
  );
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
              "You plan read-only hackathon discovery. Return only JSON. Do not invent tools or source names. Choose only supplied sources. Every supplied source must appear in sourceIntents. You may order sources and assign queries. Do not silently omit a supplied source; skip only with enabled=false and a concrete reason. Keep the plan small and verification-focused.",
          },
          {
            role: "user",
            content: JSON.stringify({
              command: preferences.rawCommand,
              explicitSources: preferences.sources,
              sourceCapabilities: sourceCapabilitiesForPrompt(preferences.sources),
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
          schema: jsonSchemaForPlanner(preferences.sources),
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
