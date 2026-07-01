#!/usr/bin/env node

import { loadLocalEnv } from "@/cli/loadEnv";
import { runAgent } from "@/agent/runAgent";

loadLocalEnv();

function parseArgs(argv: string[]): { command: string; dryRun: boolean } {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const commandParts = args.filter((arg) => arg !== "--dry-run" && arg !== "--");

  const command = commandParts.join(" ").trim();

  if (!command) {
    console.error('Usage: npm run agent -- "find upcoming hackathons" [-- --dry-run]');
    process.exit(1);
  }

  return { command, dryRun };
}

async function main(): Promise<void> {
  const { command, dryRun } = parseArgs(process.argv);

  try {
    await runAgent(command, dryRun);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Agent run failed");
    process.exit(1);
  }
}

void main();
