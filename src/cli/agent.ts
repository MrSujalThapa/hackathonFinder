#!/usr/bin/env node

import { loadLocalEnv } from "@/cli/loadEnv";
import { runAgent } from "@/agent/runAgent";
import { parseAgentArgs } from "@/cli/parseAgentArgs";

loadLocalEnv();

async function main(): Promise<void> {
  let options;

  try {
    options = parseAgentArgs(process.argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid CLI arguments");
    process.exit(1);
  }

  try {
    await runAgent(options.command, options.dryRun, {
      sources: options.sources,
      maxResults: options.maxResults,
      allowMockWrites: options.allowMockWrites,
      sourceTimeoutMs: options.sourceTimeoutMs,
      totalTimeoutMs: options.totalTimeoutMs,
      showSearchPlan: options.showSearchPlan,
      dryRunPlan: options.dryRunPlan,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Agent run failed");
    process.exit(1);
  }
}

void main();
