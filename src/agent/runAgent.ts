import { printAgentSummary } from "@/agent/summary";
import type { ReviewPolicy, SourceName } from "@/core/discovery/types";
import {
  createStdoutEventSink,
  runDiscovery,
  type DiscoveryRunMode,
} from "@/discovery";

export type RunAgentOptions = {
  sources?: SourceName[];
  maxResults?: number;
  reviewPolicy?: ReviewPolicy;
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

/**
 * Thin CLI adapter around the shared discovery service.
 * Formats structured events to stdout and prints the final summary.
 */
export async function runAgent(
  rawCommand: string,
  dryRun: boolean,
  cliOptions: RunAgentOptions = {},
): Promise<void> {
  const mode: DiscoveryRunMode = cliOptions.deterministic
    ? "deterministic"
    : cliOptions.agent
      ? "agent"
      : "auto";

  const eventSink = createStdoutEventSink();

  const result = await runDiscovery({
    command: rawCommand,
    mode,
    sources: cliOptions.sources,
    maxResults: cliOptions.maxResults,
    reviewPolicy: cliOptions.reviewPolicy,
    allowMockWrites: cliOptions.allowMockWrites,
    sourceTimeoutMs: cliOptions.sourceTimeoutMs,
    totalTimeoutMs: cliOptions.totalTimeoutMs,
    showSearchPlan: cliOptions.showSearchPlan,
    showXPlan: cliOptions.showXPlan,
    dryRunPlan: cliOptions.dryRunPlan,
    verbose: cliOptions.verbose,
    maxAgentCalls: cliOptions.maxAgentCalls,
    showAgentPlan: cliOptions.showAgentPlan,
    showAgentTrace: cliOptions.showAgentTrace,
    dryRun: dryRun || Boolean(cliOptions.dryRunPlan),
    eventSink,
  });

  if (cliOptions.showAgentPlan && result.summary.agent) {
    console.log("Agent plan:");
    console.log(`- mode: ${result.summary.agent.mode}`);
    console.log(`- sources: ${result.effectiveSources.join(", ")}`);
    console.log(`- stop reason: ${result.summary.agent.stopReason}`);
    console.log("");
  }

  printAgentSummary(result.summary);
}
