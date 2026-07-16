import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnv } from "@/cli/loadEnv";
import { getDefaultDiscoveryPreferences } from "@/agent/parseCommand";
import { getCollector } from "@/collectors/registry";

loadLocalEnv();

async function main(): Promise<void> {
  const outDir = resolve(process.cwd(), ".local-audits/traces/full-directory-recall");
  mkdirSync(outDir, { recursive: true });
  const preferences = {
    ...getDefaultDiscoveryPreferences("find AI hackathons in Toronto --profile deep"),
    sources: ["luma" as const],
    profile: "deep" as const,
  };
  const collector = getCollector("luma");
  const result = await collector.collect({
    preferences,
    maxResults: 200,
    timeoutMs: 300_000,
    logger: (message) => console.log(message),
  });
  const summary = {
    measuredAt: new Date().toISOString(),
    leads: result.leads.length,
    metrics: result.metrics,
    stop: result.diagnostics.stopReason,
    warnings: result.warnings.filter((warning) =>
      /unique_cards_|classified_|theme_|stop_reason_|collected_raw/.test(warning),
    ),
    sampleTitles: result.leads.slice(0, 30).map((lead) => lead.title),
  };
  const out = resolve(outDir, `luma-deep-rerun-${Date.now()}.json`);
  writeFileSync(out, JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Wrote ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
