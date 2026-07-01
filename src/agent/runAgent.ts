import { parseCommand } from "@/agent/parseCommand";
import { runDiscovery } from "@/agent/controller";
import { printAgentSummary } from "@/agent/summary";

export async function runAgent(rawCommand: string, dryRun: boolean): Promise<void> {
  const preferences = parseCommand(rawCommand);
  const summary = await runDiscovery(preferences, dryRun);
  printAgentSummary(summary);
}
