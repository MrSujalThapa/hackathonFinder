#!/usr/bin/env tsx
/**
 * B2 live custom-kernel benchmarks (manual / outside deterministic CI).
 * Usage: npx tsx scripts/b2-custom-kernel-benchmark.ts
 */
import { collectCustomSourceViaKernel } from "@/crawl/adapters/custom/collect";
import { loadLocalEnv } from "@/cli/loadEnv";
import type { CustomSource } from "@/server/customSources/types";

loadLocalEnv();

function source(slug: string, listingUrl: string, maxItems = 40): CustomSource {
  const baseUrl = new URL(listingUrl).origin;
  return {
    id: `b2-${slug}`,
    name: slug,
    slug,
    baseUrl,
    listingUrl,
    mode: "auto",
    enabled: true,
    locationScope: "",
    topicScope: [],
    maxItems,
    status: "unknown",
    lastCheckedAt: null,
    lastErrorSafe: null,
    selectors: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const targets = [
    { label: "hackathons.space", listingUrl: "https://www.hackathons.space/", maxItems: 40 },
    { label: "eventornado", listingUrl: "https://eventornado.com/events", maxItems: 40 },
    { label: "taikai", listingUrl: "https://taikai.network/hackathons", maxItems: 40 },
    { label: "dorahacks", listingUrl: "https://dorahacks.io/hackathon", maxItems: 10 },
  ];

  for (const target of targets) {
    console.log(`\n=== ${target.label} ===`);
    const started = Date.now();
    try {
      const result = await collectCustomSourceViaKernel(
        source(target.label, target.listingUrl, target.maxItems),
        {
          persistHealth: false,
          logger: (message) => console.log(message),
        },
      );
      console.log(
        JSON.stringify(
          {
            label: target.label,
            leads: result.leads.length,
            status: result.status,
            stopReason: result.diagnostics.stopReason,
            safeMessage: result.diagnostics.safeMessage,
            pages: result.diagnostics.pagesTraversed,
            warnings: result.warnings.slice(0, 12),
            metrics: result.metrics,
            sampleTitles: result.leads.slice(0, 5).map((lead) => lead.title),
            durationMs: Date.now() - started,
            hasLlm: Boolean(process.env.LLM_PROVIDER && process.env.LLM_API_KEY),
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error(target.label, error);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
