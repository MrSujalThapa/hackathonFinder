import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadLocalEnv } from "@/cli/loadEnv";
import {
  formatGenericStructuredExtractionResult,
  runGenericStructuredExtraction,
} from "@/experiments/scraper-v2/generic/structuredExtraction";
import type { SourceExperiment } from "@/experiments/scraper-v2/generic/types";

loadLocalEnv();

const DEFAULT_TRACE_DIR = path.join(".local-audits", "traces", "phase-4");

function argValue(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function numericArg(name: string, fallback: number): number {
  const raw = argValue(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function boolArg(name: string, fallback: boolean): boolean {
  const raw = argValue(name);
  if (!raw) return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function traceNameForUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}.md`;
}

function experimentFromArgs(): SourceExperiment {
  const inputUrl = argValue("--url");
  if (!inputUrl) {
    throw new Error("Usage: npm run experiment:structured-extraction -- --url=<public-directory-url>");
  }
  const parsed = new URL(inputUrl);
  const extraOrigins = (argValue("--allowed-origin") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    inputUrl: parsed.toString(),
    allowedOrigins: [...new Set([parsed.origin, ...extraOrigins])],
    maxRequests: numericArg("--max-requests", 40),
    maxPages: numericArg("--max-pages", 3),
    maxPayloadBytes: numericArg("--max-payload-bytes", 5_000_000),
    browserAllowed: boolArg("--browser", true),
    expectedContentCategory: "public_event_directory",
    expectedMinimumEventCount: numericArg("--expected-min-events", 0) || undefined,
  };
}

async function main(): Promise<void> {
  const experiment = experimentFromArgs();
  const traceDir = argValue("--trace-dir") ?? DEFAULT_TRACE_DIR;
  const result = await runGenericStructuredExtraction(experiment);
  const lines = formatGenericStructuredExtractionResult(result);
  console.log(lines.join("\n"));

  await mkdir(traceDir, { recursive: true });
  const trace = [
    `# Generic Structured Extraction Trace`,
    "",
    `Input: ${result.inputUrl}`,
    `Final URL: ${result.finalUrl}`,
    `Persistence: disabled`,
    "",
    "## Summary",
    "",
    ...lines.map((line) => `    ${line}`),
    "",
    "## Candidate Record Sets",
    "",
    "| Rank | Artifact | Path | Records | Structural | Event | Confidence | Reasons |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |",
    ...result.candidateRecordSets.slice(0, 12).map((set, index) =>
      `| ${index + 1} | ${set.artifactKind} | \`${set.path || "<root>"}\` | ${set.records} | ${set.structuralScore} | ${set.eventScore} | ${set.confidence} | ${set.rejectionReasons.join("; ")} |`,
    ),
    "",
    "## Field Schema",
    "",
    "```json",
    JSON.stringify(result.schema ?? null, null, 2),
    "```",
    "",
    "## DOM Inference",
    "",
    "| Rank | Artifact | Parent | Units | Confidence | Title Unique | URL Unique | Date Coverage | Reasons |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...(result.dom?.repeatedUnitSets.slice(0, 12).map((set, index) =>
      `| ${index + 1} | ${set.artifactId} | ${set.parentNodeId} | ${set.diagnostics.unitCount} | ${set.confidence} | ${set.diagnostics.uniqueTitleRatio} | ${set.diagnostics.uniqueUrlRatio} | ${set.diagnostics.dateCoverage} | ${set.rejectionReasons.join("; ")} |`,
    ) ?? []),
    "",
    "## DOM Schema",
    "",
    "```json",
    JSON.stringify(result.dom?.schema ?? null, null, 2),
    "```",
    "",
    "## Quality",
    "",
    "```json",
    JSON.stringify(result.quality, null, 2),
    "```",
    "",
    "## Safe Lead Sample",
    "",
    ...result.leads.slice(0, 20).map((lead) => `- ${lead.title}${lead.canonicalUrl ? ` (${lead.canonicalUrl})` : ""}`),
    "",
  ].join("\n");
  await writeFile(path.join(traceDir, traceNameForUrl(result.inputUrl)), trace, "utf8");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
