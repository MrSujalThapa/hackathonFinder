/**
 * Bounded collector smoke probes for SOURCE_AUDIT (read-only, dryRun).
 * Uses tsx loader via: npx tsx docs/discovery/audit-notes/probe-collectors.mjs
 */
import { loadLocalEnv } from "../../../src/cli/loadEnv.ts";
import { parseCommand } from "../../../src/agent/parseCommand.ts";
import { runCollectors } from "../../../src/collectors/registry.ts";

loadLocalEnv();

const preferences = parseCommand("find upcoming AI hackathons in Canada or remote");
const sources = ["hacklist", "mlh", "luma", "web", "devpost", "hakku"];

const results = await runCollectors(
  {
    preferences: { ...preferences, sources, maxResults: 8 },
    maxResults: 8,
    timeoutMs: 12_000,
    dryRun: true,
  },
  sources,
);

for (const r of results) {
  console.log(
    JSON.stringify({
      source: r.source,
      leads: r.leads.length,
      durationMs: r.durationMs,
      warnings: r.warnings.slice(0, 3),
      errors: r.errors.slice(0, 3),
      sampleTitles: r.leads.slice(0, 2).map((l) => l.title),
    }),
  );
}
