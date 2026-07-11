import { applyCliOptions, parseCommand } from "@/agent/parseCommand";
import { runDiscovery } from "@/agent/controller";
import { printAgentSummary } from "@/agent/summary";
import type { SourceName } from "@/core/discovery/types";

export type RunAgentOptions = {
  sources?: SourceName[];
  maxResults?: number;
};

export async function runAgent(
  rawCommand: string,
  dryRun: boolean,
  cliOptions: RunAgentOptions = {},
): Promise<void> {
  const parsed = parseCommand(rawCommand);
  const preferences = applyCliOptions(parsed, cliOptions);
  const summary = await runDiscovery(preferences, dryRun);
  printAgentSummary(summary);
}
