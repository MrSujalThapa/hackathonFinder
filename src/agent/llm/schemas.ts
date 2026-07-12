import { z } from "zod";
import { discoveryPreferencesSchema } from "@/core/discovery/schemas";
import { AGENT_TOOL_NAMES } from "@/agent/runtime/tools";

export const discoveryIntentSchema = z.object({
  kind: z.literal("discover_hackathons"),
  rawCommand: z.string().min(1),
  preferences: discoveryPreferencesSchema,
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});

export const unknownIntentSchema = z.object({
  kind: z.literal("unknown"),
  rawCommand: z.string(),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});

export const agentIntentSchema = z.discriminatedUnion("kind", [
  discoveryIntentSchema,
  unknownIntentSchema,
]);

export const plannedToolNameSchema = z.enum([
  AGENT_TOOL_NAMES.collectHacklist,
  AGENT_TOOL_NAMES.collectMlh,
  AGENT_TOOL_NAMES.collectLuma,
  AGENT_TOOL_NAMES.collectDevpost,
  AGENT_TOOL_NAMES.collectHakku,
  AGENT_TOOL_NAMES.collectWeb,
  AGENT_TOOL_NAMES.collectX,
  AGENT_TOOL_NAMES.enrichUrl,
  AGENT_TOOL_NAMES.inspectCandidateEvidence,
  AGENT_TOOL_NAMES.searchCandidateWeb,
  AGENT_TOOL_NAMES.finalizeDiscoveryPlan,
]);

export const plannedToolCallSchema = z.object({
  id: z.string().min(1),
  name: plannedToolNameSchema,
  args: z.unknown(),
  reason: z.string().optional(),
});

export const discoveryPlanSchema = z.object({
  id: z.string().min(1),
  intent: agentIntentSchema,
  summary: z.string(),
  toolCalls: z.array(plannedToolCallSchema),
  warnings: z.array(z.string()),
});

export type DiscoveryIntent = z.infer<typeof discoveryIntentSchema>;
export type AgentIntent = z.infer<typeof agentIntentSchema>;
export type PlannedToolCall = z.infer<typeof plannedToolCallSchema>;
export type DiscoveryPlan = z.infer<typeof discoveryPlanSchema>;
