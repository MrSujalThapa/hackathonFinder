import type { SourceName } from "@/core/discovery/types";
import { parseSourcesFlag } from "@/collectors/registry";

export type CliOptions = {
  command: string;
  dryRun: boolean;
  allowMockWrites: boolean;
  sources?: SourceName[];
  maxResults?: number;
};

export function parseAgentArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const allowMockWrites = args.includes("--allow-mock-writes");

  const sourcesArg = args.find((arg) => arg.startsWith("--sources="));
  const maxResultsArg = args.find((arg) => arg.startsWith("--max-results="));

  const commandParts = args.filter(
    (arg) =>
      arg !== "--dry-run" &&
      arg !== "--allow-mock-writes" &&
      arg !== "--" &&
      !arg.startsWith("--sources=") &&
      !arg.startsWith("--max-results="),
  );

  const command = commandParts.join(" ").trim();

  if (!command) {
    throw new Error(
      'Usage: npm run agent -- "find upcoming hackathons" [-- --dry-run] [-- --sources=hacklist,devpost,hakku] [-- --max-results=20] [-- --allow-mock-writes]',
    );
  }

  const sources = sourcesArg ? parseSourcesFlag(sourcesArg.slice("--sources=".length)) : undefined;
  const maxResults = maxResultsArg
    ? Number.parseInt(maxResultsArg.slice("--max-results=".length), 10)
    : undefined;

  if (maxResultsArg && (maxResults === undefined || Number.isNaN(maxResults) || maxResults < 1)) {
    throw new Error("--max-results must be a positive integer");
  }

  if (sourcesArg && (!sources || sources.length === 0)) {
    throw new Error("--sources must include at least one registered source");
  }

  return { command, dryRun, allowMockWrites, sources, maxResults };
}
