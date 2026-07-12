import type { SourceName } from "@/core/discovery/types";
import { parseSourcesFlag } from "@/collectors/registry";

export type CliOptions = {
  command: string;
  dryRun: boolean;
  allowMockWrites: boolean;
  sources?: SourceName[];
  maxResults?: number;
  sourceTimeoutMs?: number;
  totalTimeoutMs?: number;
  showSearchPlan: boolean;
  dryRunPlan: boolean;
  verbose: boolean;
};

function parsePositiveInt(flag: string, raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

export function parseAgentArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const allowMockWrites = args.includes("--allow-mock-writes");
  const showSearchPlan = args.includes("--show-search-plan");
  const dryRunPlan = args.includes("--dry-run-plan");
  const verbose = args.includes("--verbose");

  const sourcesArg = args.find((arg) => arg.startsWith("--sources="));
  const maxResultsArg = args.find((arg) => arg.startsWith("--max-results="));
  const sourceTimeoutArg = args.find((arg) => arg.startsWith("--source-timeout-ms="));
  const totalTimeoutArg = args.find((arg) => arg.startsWith("--total-timeout-ms="));

  const commandParts = args.filter(
    (arg) =>
      arg !== "--dry-run" &&
      arg !== "--allow-mock-writes" &&
      arg !== "--show-search-plan" &&
      arg !== "--dry-run-plan" &&
      arg !== "--verbose" &&
      arg !== "--" &&
      !arg.startsWith("--sources=") &&
      !arg.startsWith("--max-results=") &&
      !arg.startsWith("--source-timeout-ms=") &&
      !arg.startsWith("--total-timeout-ms="),
  );

  const command = commandParts.join(" ").trim();

  if (!command) {
    throw new Error(
      'Usage: npm run agent -- "find upcoming hackathons" [-- --dry-run] [-- --sources=hacklist,mlh,luma,web,x] [-- --max-results=20] [-- --source-timeout-ms=15000] [-- --total-timeout-ms=45000] [-- --show-search-plan] [-- --dry-run-plan] [-- --verbose] [-- --allow-mock-writes]',
    );
  }

  let sources: SourceName[] | undefined;
  if (sourcesArg) {
    sources = parseSourcesFlag(sourcesArg.slice("--sources=".length));
  }

  const maxResults = maxResultsArg
    ? parsePositiveInt("--max-results", maxResultsArg.slice("--max-results=".length))
    : undefined;
  const sourceTimeoutMs = sourceTimeoutArg
    ? parsePositiveInt(
        "--source-timeout-ms",
        sourceTimeoutArg.slice("--source-timeout-ms=".length),
      )
    : undefined;
  const totalTimeoutMs = totalTimeoutArg
    ? parsePositiveInt(
        "--total-timeout-ms",
        totalTimeoutArg.slice("--total-timeout-ms=".length),
      )
    : undefined;

  if (sourcesArg && (!sources || sources.length === 0)) {
    throw new Error("--sources must include at least one registered source");
  }

  return {
    command,
    dryRun,
    allowMockWrites,
    sources,
    maxResults,
    sourceTimeoutMs,
    totalTimeoutMs,
    showSearchPlan,
    dryRunPlan,
    verbose,
  };
}
