#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectCustomSource } from "@/collectors/customSource";
import { compareShadowResults } from "@/experiments/scraper-v2/compareShadowResults";
import {
  formatDevfolioShadowResult,
  runDevfolioStructuredShadow,
} from "@/experiments/scraper-v2/devfolioStructuredShadow";
import { DEVFOLIO_CONFIG } from "@/experiments/scraper-v2/devfolioConfig";
import type { CustomSource } from "@/server/customSources/types";

const TRACE_DIR = path.join(".local-audits", "traces", "phase-2-devfolio");

const DEVFOLIO_V1_SOURCE: CustomSource = {
  id: "shadow-devfolio",
  name: "Devfolio Shadow",
  slug: "devfolio",
  baseUrl: "https://devfolio.co",
  listingUrl: DEVFOLIO_CONFIG.listingUrl,
  mode: "static",
  enabled: true,
  locationScope: "global",
  topicScope: ["hackathons"],
  maxItems: 40,
  status: "unknown",
  lastCheckedAt: null,
  lastErrorSafe: null,
  selectors: { strategy: "auto" },
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

async function writeComparisonTrace(markdown: string): Promise<void> {
  await mkdir(TRACE_DIR, { recursive: true });
  await writeFile(path.join(TRACE_DIR, "v1-v2-comparison.md"), markdown, "utf8");
}

function comparisonMarkdown(v1Count: number, comparison: ReturnType<typeof compareShadowResults>): string {
  return [
    "# Devfolio V1/V2 Shadow Comparison",
    "",
    "No candidates or evidence were persisted. V1 ran through the unchanged custom-source collector with health persistence disabled.",
    "",
    "| Metric | V1 | V2 |",
    "| --- | ---: | ---: |",
    `| Units / structured records | ${v1Count} | ${comparison.v2StructuredRecords} |`,
    `| Normalized leads | ${comparison.v1NormalizedLeads} | ${comparison.v2NormalizedLeads} |`,
    `| Valid events | ${comparison.v1NormalizedLeads - comparison.v1ObviousNonEvents} | ${comparison.v2ValidEvents} |`,
    `| Obvious non-events | ${comparison.v1ObviousNonEvents} | ${comparison.v2ObviousNonEvents} |`,
    `| Overlapping titles | ${comparison.overlappingTitles} | ${comparison.overlappingTitles} |`,
    "",
    "V2-only title sample:",
    ...comparison.v2OnlyTitles.map((title) => `- ${title}`),
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const v2 = await runDevfolioStructuredShadow();
  for (const line of formatDevfolioShadowResult(v2)) {
    console.log(line);
  }

  const v1 = await collectCustomSource(DEVFOLIO_V1_SOURCE, {
    persistHealth: false,
    timeoutMs: 20_000,
  });
  const comparison = compareShadowResults(v1.leads, v2);
  await writeComparisonTrace(comparisonMarkdown(v1.diagnostics.detectedUnits ?? v1.leads.length, comparison));

  console.log("");
  console.log("[shadow-v2:devfolio] V1/V2 comparison");
  console.log(`  V1 normalized leads       ${comparison.v1NormalizedLeads}`);
  console.log(`  V1 obvious non-events     ${comparison.v1ObviousNonEvents}`);
  console.log(`  V2 normalized leads       ${comparison.v2NormalizedLeads}`);
  console.log(`  V2 valid events           ${comparison.v2ValidEvents}`);
  console.log(`  V2 obvious non-events     ${comparison.v2ObviousNonEvents}`);
  console.log("  persistence               disabled");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Devfolio shadow experiment failed");
  process.exit(1);
});
