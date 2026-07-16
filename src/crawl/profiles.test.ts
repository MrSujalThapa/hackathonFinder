import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CRAWL_PROFILE_NAMES, isCrawlProfileName } from "@/crawl/profiles";
import { discoveryProfileSchema } from "@/core/discovery/schemas";
import {
  classifyUniqueCapStop,
  sourceStateForStopReason,
} from "@/crawl/stopReasons";
import type { CrawlStopReason } from "@/crawl/types";

describe("canonical crawl profiles", () => {
  it("matches DiscoveryProfile enum", () => {
    for (const name of CRAWL_PROFILE_NAMES) {
      assert.equal(discoveryProfileSchema.parse(name), name);
      assert.equal(isCrawlProfileName(name), true);
    }
    assert.equal(isCrawlProfileName("quick"), false);
  });
});

describe("canonical stop and source-state mapping", () => {
  const stops: CrawlStopReason[] = [
    "exhausted",
    "no_growth",
    "target_reached",
    "maximum_cards_reached",
    "max_budget",
    "timeout",
    "cancelled",
    "acquisition_failed",
    "blocked_authentication",
    "blocked_human_verification",
  ];

  it("maps every stop reason to a Terminal-facing source state", () => {
    for (const stop of stops) {
      assert.ok(sourceStateForStopReason(stop));
    }
  });

  it("prefers target_reached over maximum when stopAtTarget", () => {
    assert.equal(
      classifyUniqueCapStop({
        unique: 75,
        targetUnique: 75,
        maxUnique: 100,
        stopAtTarget: true,
      }),
      "target_reached",
    );
    assert.equal(
      classifyUniqueCapStop({
        unique: 500,
        targetUnique: 300,
        maxUnique: 500,
        stopAtTarget: false,
      }),
      "maximum_cards_reached",
    );
  });
});

describe("production experiment reachability", () => {
  it("has no static production imports of src/experiments scraper-v2", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const roots = ["src/crawl", "src/collectors", "src/discovery", "src/app", "src/server", "src/jobs"];
    const hits: string[] = [];

    function walk(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry) || entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) {
          continue;
        }
        const text = readFileSync(full, "utf8");
        if (/from\s+["']@\/experiments|import\(["']@\/experiments|experiments\/scraper-v2/.test(text)) {
          hits.push(full);
        }
      }
    }

    for (const root of roots) walk(root);
    assert.deepEqual(hits, []);
  });
});
