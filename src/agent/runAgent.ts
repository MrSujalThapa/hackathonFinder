import { applyCliOptions, parseCommand } from "@/agent/parseCommand";
import { runDiscovery } from "@/agent/controller";
import { printAgentSummary } from "@/agent/summary";
import type { SourceName } from "@/core/discovery/types";

export type RunAgentOptions = {
  sources?: SourceName[];
  maxResults?: number;
  allowMockWrites?: boolean;
  sourceTimeoutMs?: number;
  totalTimeoutMs?: number;
  showSearchPlan?: boolean;
  dryRunPlan?: boolean;
  verbose?: boolean;
};

export async function runAgent(
  rawCommand: string,
  dryRun: boolean,
  cliOptions: RunAgentOptions = {},
): Promise<void> {
  const parsed = parseCommand(rawCommand);
  const preferences = applyCliOptions(parsed, cliOptions);
  const summary = await runDiscovery(preferences, dryRun || Boolean(cliOptions.dryRunPlan), {
    allowMockWrites: cliOptions.allowMockWrites,
    sourceTimeoutMs: cliOptions.sourceTimeoutMs,
    totalTimeoutMs: cliOptions.totalTimeoutMs,
    showSearchPlan: cliOptions.showSearchPlan,
    dryRunPlan: cliOptions.dryRunPlan,
    verbose: cliOptions.verbose,
  });
  printAgentSummary(summary);
}
