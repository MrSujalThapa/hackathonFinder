import type { AgentRunSummary, DiscoveryPreferences } from "@/core/discovery/types";
import {
  executeDiscoveryPipeline,
  type DiscoveryPipelineOptions,
} from "@/discovery/pipeline";

export type RunDiscoveryOptions = DiscoveryPipelineOptions;

/**
 * Compatibility adapter for existing callers/tests that pass preferences + dryRun.
 * New code should prefer `runDiscovery` from `@/discovery`.
 */
export async function runDiscovery(
  preferences: DiscoveryPreferences,
  dryRun: boolean,
  options: RunDiscoveryOptions = {},
): Promise<AgentRunSummary> {
  return executeDiscoveryPipeline(preferences, dryRun, options);
}
