#!/usr/bin/env node

function parseArgs(argv: string[]): { command: string; dryRun: boolean } {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const commandParts = args.filter((arg) => arg !== "--dry-run");

  const command = commandParts.join(" ").trim();

  if (!command) {
    console.error('Usage: npm run agent -- "find upcoming hackathons" [-- --dry-run]');
    process.exit(1);
  }

  return { command, dryRun };
}

function printPlaceholderSummary(command: string, dryRun: boolean): void {
  console.log("Hackathon Approval Agent");
  console.log("========================");
  console.log(`Raw command: ${command}`);
  if (dryRun) {
    console.log("Mode: dry-run (no database writes)");
  }
  console.log("");
  console.log("Agent run complete (placeholder)");
  console.log("Raw leads: 0");
  console.log("Parsed events: 0");
  console.log("Duplicates updated: 0");
  console.log("New candidates: 0");
  console.log("Rejected: 0");
  console.log("Needs review: 0");
  console.log("Duration: 0.0s");
  console.log("");
  console.log("Discovery pipeline not wired yet — collectors land in later steps.");
}

function main(): void {
  const { command, dryRun } = parseArgs(process.argv);
  printPlaceholderSummary(command, dryRun);
}

main();
