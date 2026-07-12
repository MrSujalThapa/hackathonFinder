import { z } from "zod";
import { parseCommand } from "@/agent/parseCommand";
import { planSearchQueries } from "@/agent/planSearchQueries";
import { planXQueries } from "@/agent/planXQueries";
import { runCollectors } from "@/collectors/registry";
import { discoveryPreferencesSchema, sourceNameSchema } from "@/core/discovery/schemas";
import type { SourceName } from "@/core/discovery/types";
import type { AgentTool } from "./types";

export const AGENT_TOOL_NAMES = {
  parseDiscoveryIntent: "parse_discovery_intent",
  planSearchQueries: "plan_search_queries",
  planXQueries: "plan_x_queries",
  collectSources: "collect_sources",
} as const;

const parseDiscoveryIntentArgsSchema = z.object({
  command: z.string().min(1),
});

const planSearchQueriesArgsSchema = z.object({
  preferences: discoveryPreferencesSchema,
});

const planXQueriesArgsSchema = z.object({
  preferences: discoveryPreferencesSchema,
  maxQueries: z.number().int().positive().optional(),
});

const collectSourcesArgsSchema = z.object({
  preferences: discoveryPreferencesSchema,
  sources: z.array(sourceNameSchema).optional(),
  dryRun: z.boolean().default(true),
  maxResults: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  requestId: z.string().optional(),
});

export const parseDiscoveryIntentTool: AgentTool<
  z.infer<typeof parseDiscoveryIntentArgsSchema>,
  { preferences: ReturnType<typeof parseCommand> }
> = {
  name: AGENT_TOOL_NAMES.parseDiscoveryIntent,
  description: "Parse a natural-language discovery command into discovery preferences.",
  schema: parseDiscoveryIntentArgsSchema,
  execute(args) {
    return { preferences: parseCommand(args.command) };
  },
};

export const planSearchQueriesTool: AgentTool<
  z.infer<typeof planSearchQueriesArgsSchema>,
  { queries: string[] }
> = {
  name: AGENT_TOOL_NAMES.planSearchQueries,
  description: "Plan deterministic web search queries for discovery preferences.",
  schema: planSearchQueriesArgsSchema,
  execute(args) {
    return { queries: planSearchQueries(args.preferences) };
  },
};

export const planXQueriesTool: AgentTool<
  z.infer<typeof planXQueriesArgsSchema>,
  { queries: string[] }
> = {
  name: AGENT_TOOL_NAMES.planXQueries,
  description: "Plan deterministic X search queries for discovery preferences.",
  schema: planXQueriesArgsSchema,
  execute(args) {
    return {
      queries: planXQueries(args.preferences, { maxQueries: args.maxQueries }),
    };
  },
};

export const collectSourcesTool: AgentTool<
  z.infer<typeof collectSourcesArgsSchema>,
  {
    sources: SourceName[];
    leadCount: number;
    results: Awaited<ReturnType<typeof runCollectors>>;
    errors: string[];
    warnings: string[];
  }
> = {
  name: AGENT_TOOL_NAMES.collectSources,
  description: "Run registered collectors for the selected discovery sources.",
  schema: collectSourcesArgsSchema,
  async execute(args, context) {
    const sources = args.sources ?? args.preferences.sources;
    const timeoutMs = args.timeoutMs ?? context.limits.perToolTimeoutMs;
    const results = await runCollectors(
      {
        preferences: args.preferences,
        maxResults: args.maxResults ?? args.preferences.maxResults,
        timeoutMs,
        dryRun: args.dryRun,
        requestId: args.requestId ?? context.requestId,
      },
      sources,
    );

    return {
      sources,
      results,
      leadCount: results.reduce((sum, result) => sum + result.leads.length, 0),
      errors: results.flatMap((result) => result.errors),
      warnings: results.flatMap((result) => result.warnings),
    };
  },
};

export function getDefaultAgentTools(): AgentTool[] {
  return [
    parseDiscoveryIntentTool,
    planSearchQueriesTool,
    planXQueriesTool,
    collectSourcesTool,
  ];
}
