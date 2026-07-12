import { z } from "zod";
import { planSearchQueries } from "@/agent/planSearchQueries";
import { runCollectors } from "@/collectors/registry";
import { enrichPromisingLeads } from "@/core/enrichLead";
import { discoveryPreferencesSchema, sourceNameSchema } from "@/core/discovery/schemas";
import type { SourceName } from "@/core/discovery/types";
import type { AgentTool } from "./types";

export const AGENT_TOOL_NAMES = {
  collectHacklist: "collect_hacklist",
  collectMlh: "collect_mlh",
  collectLuma: "collect_luma",
  collectDevpost: "collect_devpost",
  collectHakku: "collect_hakku",
  collectWeb: "collect_web",
  collectX: "collect_x",
  enrichUrl: "enrich_url",
  inspectCandidateEvidence: "inspect_candidate_evidence",
  searchCandidateWeb: "search_candidate_web",
  finalizeDiscoveryPlan: "finalize_discovery_plan",
} as const;

const collectSourceArgsSchema = z.object({
  preferences: discoveryPreferencesSchema,
  dryRun: z.boolean().default(true),
  maxResults: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  requestId: z.string().optional(),
});

const enrichUrlArgsSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  source: sourceNameSchema.default("web"),
  timeoutMs: z.number().int().positive().optional(),
});

const inspectCandidateEvidenceArgsSchema = z.object({
  candidateId: z.string().min(1),
  evidence: z.array(z.object({
    type: z.string(),
    url: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    snippet: z.string().optional().nullable(),
    raw: z.unknown().optional(),
  })).default([]),
});

const searchCandidateWebArgsSchema = z.object({
  preferences: discoveryPreferencesSchema,
  query: z.string().min(1).optional(),
  maxResults: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const finalizeDiscoveryPlanArgsSchema = z.object({
  selectedSources: z.array(sourceNameSchema),
  searchQueries: z.array(z.string()).default([]),
  stopReason: z.string().min(1),
  warnings: z.array(z.string()).default([]),
});

function collectorTool(name: string, source: SourceName): AgentTool<
  z.infer<typeof collectSourceArgsSchema>,
  {
    sources: SourceName[];
    leadCount: number;
    results: Awaited<ReturnType<typeof runCollectors>>;
    errors: string[];
    warnings: string[];
  }
> {
  return {
    name,
    description: `Run the ${source} collector under runtime limits.`,
    schema: collectSourceArgsSchema,
    async execute(args, context) {
      const timeoutMs = Math.min(
        args.timeoutMs ?? context.limits.perToolTimeoutMs,
        context.limits.perToolTimeoutMs,
      );
      const preferences = {
        ...args.preferences,
        sources: [source],
        maxResults: args.maxResults ?? args.preferences.maxResults,
      };
      const results = await runCollectors(
        {
          preferences,
          maxResults: preferences.maxResults,
          timeoutMs,
          dryRun: args.dryRun,
          requestId: args.requestId ?? context.requestId,
        },
        [source],
      );

      return {
        sources: [source],
        results,
        leadCount: results.reduce((sum, result) => sum + result.leads.length, 0),
        errors: results.flatMap((result) => result.errors),
        warnings: results.flatMap((result) => result.warnings),
      };
    },
  };
}

const enrichUrlTool: AgentTool<
  z.infer<typeof enrichUrlArgsSchema>,
  Awaited<ReturnType<typeof enrichPromisingLeads>>
> = {
  name: AGENT_TOOL_NAMES.enrichUrl,
  description: "Enrich one URL through the existing SSRF-safe lead enrichment path.",
  schema: enrichUrlArgsSchema,
  execute(args, context) {
    return enrichPromisingLeads(
      [{
        id: `agent-url:${args.url}`,
        source: args.source,
        title: args.title,
        url: args.url,
        text: args.title,
        links: [args.url],
        postedAt: new Date().toISOString(),
      }],
      {
        timeoutMs: Math.min(args.timeoutMs ?? context.limits.perToolTimeoutMs, context.limits.perToolTimeoutMs),
        maxPages: 1,
        concurrency: 1,
      },
    );
  },
};

const inspectCandidateEvidenceTool: AgentTool<
  z.infer<typeof inspectCandidateEvidenceArgsSchema>,
  { candidateId: string; evidenceCount: number; urls: string[]; snippets: string[] }
> = {
  name: AGENT_TOOL_NAMES.inspectCandidateEvidence,
  description: "Inspect already-loaded candidate evidence supplied by the caller.",
  schema: inspectCandidateEvidenceArgsSchema,
  execute(args) {
    return {
      candidateId: args.candidateId,
      evidenceCount: args.evidence.length,
      urls: args.evidence
        .map((item) => item.url)
        .filter((url): url is string => Boolean(url)),
      snippets: args.evidence
        .map((item) => item.snippet ?? item.title ?? undefined)
        .filter((snippet): snippet is string => Boolean(snippet))
        .slice(0, 10),
    };
  },
};

const searchCandidateWebTool: AgentTool<
  z.infer<typeof searchCandidateWebArgsSchema>,
  { queries: string[]; source: "web"; results: Awaited<ReturnType<typeof runCollectors>> }
> = {
  name: AGENT_TOOL_NAMES.searchCandidateWeb,
  description: "Run targeted read-only web search through the existing web collector.",
  schema: searchCandidateWebArgsSchema,
  async execute(args, context) {
    const queries = args.query ? [args.query] : planSearchQueries(args.preferences).slice(0, 3);
    const preferences = {
      ...args.preferences,
      sources: ["web" as SourceName],
      maxResults: args.maxResults ?? Math.min(args.preferences.maxResults, 5),
    };
    const results = await runCollectors(
      {
        preferences,
        maxResults: preferences.maxResults,
        timeoutMs: Math.min(args.timeoutMs ?? context.limits.perToolTimeoutMs, context.limits.perToolTimeoutMs),
        dryRun: true,
        requestId: context.requestId,
      },
      ["web"],
    );
    return { queries, source: "web", results };
  },
};

const finalizeDiscoveryPlanTool: AgentTool<
  z.infer<typeof finalizeDiscoveryPlanArgsSchema>,
  z.infer<typeof finalizeDiscoveryPlanArgsSchema>
> = {
  name: AGENT_TOOL_NAMES.finalizeDiscoveryPlan,
  description: "Finalize the inspectable discovery plan. This performs no mutations.",
  schema: finalizeDiscoveryPlanArgsSchema,
  execute(args) {
    return args;
  },
};

export function getDefaultAgentTools(): AgentTool[] {
  return [
    collectorTool(AGENT_TOOL_NAMES.collectHacklist, "hacklist"),
    collectorTool(AGENT_TOOL_NAMES.collectMlh, "mlh"),
    collectorTool(AGENT_TOOL_NAMES.collectLuma, "luma"),
    collectorTool(AGENT_TOOL_NAMES.collectDevpost, "devpost"),
    collectorTool(AGENT_TOOL_NAMES.collectHakku, "hakku"),
    collectorTool(AGENT_TOOL_NAMES.collectWeb, "web"),
    collectorTool(AGENT_TOOL_NAMES.collectX, "x"),
    enrichUrlTool,
    inspectCandidateEvidenceTool,
    searchCandidateWebTool,
    finalizeDiscoveryPlanTool,
  ];
}
