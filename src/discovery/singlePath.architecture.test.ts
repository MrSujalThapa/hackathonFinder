import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  collectCustomSourceWithV2Routing,
  readGenericScraperV2Mode,
} from "@/discovery/genericScraperV2Mode";
import {
  CUSTOM_V1_SOAK_BLOCKER,
  isCustomSourceRollbackV1,
  readCustomSourceRuntimeMode,
} from "@/crawl/adapters/custom/routing";
import {
  createPersistenceStrategy,
  isPersistenceV1Selected,
  PERSISTENCE_V1_SOAK_BLOCKER,
  selectPersistenceStrategyFromEnv,
} from "@/discovery/persistence/strategies";
import type { CustomSource } from "@/server/customSources/types";

function readSrc(rel: string): string {
  return readFileSync(resolve(rel), "utf8");
}

function blockedSource(): CustomSource {
  return {
    id: "00000000-0000-4000-8000-000000000099",
    name: "DoraHacks",
    slug: "dorahacks",
    baseUrl: "https://dorahacks.io",
    listingUrl: "https://dorahacks.io/hackathon",
    mode: "auto",
    enabled: true,
    locationScope: "",
    topicScope: [],
    maxItems: 5,
    status: "unknown",
    lastCheckedAt: null,
    lastErrorSafe: null,
    selectors: {},
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
  };
}

describe("C4 single-path production architecture", () => {
  it("keeps custom routing on DirectoryCrawlKernel for all obsolete flags", () => {
    assert.equal(readCustomSourceRuntimeMode({}), "kernel");
    assert.equal(readCustomSourceRuntimeMode({ CUSTOM_SOURCE_ROLLBACK_V1: "1" }), "kernel");
    assert.equal(readCustomSourceRuntimeMode({ CUSTOM_CRAWL_MODE: "rollback_v1" }), "kernel");
    assert.equal(isCustomSourceRollbackV1({ CUSTOM_SOURCE_ROLLBACK_V1: "1" }), false);
    assert.equal(readGenericScraperV2Mode({ GENERIC_SCRAPER_V2_MODE: "shadow" }), "live");
    assert.match(CUSTOM_V1_SOAK_BLOCKER, /unreachable|soak|2026-07/);
  });

  it("selects batch persistence for normal and obsolete strategy names", () => {
    assert.equal(selectPersistenceStrategyFromEnv({}).name, "batch");
    assert.equal(selectPersistenceStrategyFromEnv({ PERSISTENCE_STRATEGY: "v1" }).name, "batch");
    assert.equal(selectPersistenceStrategyFromEnv({ PERSISTENCE_STRATEGY: "weird" }).name, "batch");
    assert.equal(isPersistenceV1Selected({}), false);
    assert.equal(createPersistenceStrategy(selectPersistenceStrategyFromEnv({})).name, "batch");
    assert.match(PERSISTENCE_V1_SOAK_BLOCKER, /unreachable in normal production/);
  });

  it("pipeline custom entry does not statically import collectors/customSource V1 collect", () => {
    const pipeline = readSrc("src/discovery/pipeline.ts");
    const router = readSrc("src/discovery/genericScraperV2Mode.ts");
    assert.match(pipeline, /collectCustomSourceWithV2Routing/);
    assert.doesNotMatch(pipeline, /from ["']@\/collectors\/customSource["']/);
    assert.match(router, /collectCustomSourceViaKernel/);
    assert.doesNotMatch(router, /from ["']@\/collectors\/customSource["']/);
  });

  it("production sources have zero static imports of src/experiments", () => {
    const productionFiles = [
      "src/discovery/pipeline.ts",
      "src/discovery/genericScraperV2Mode.ts",
      "src/discovery/persistence/strategies.ts",
      "src/crawl/kernel.ts",
      "src/crawl/adapters/custom/collect.ts",
      "src/crawl/adapters/custom/adapter.ts",
      "src/collectors/devpost.ts",
      "src/collectors/luma.ts",
      "src/collectors/hakku.ts",
    ];
    for (const rel of productionFiles) {
      const text = readSrc(rel);
      assert.doesNotMatch(
        text,
        /from ["']@\/experiments(?:\/|["'])/,
        `${rel} must not import @/experiments`,
      );
    }
  });

  it("blocks DoraHacks on the kernel path without selectable V1", async () => {
    const result = await collectCustomSourceWithV2Routing(blockedSource(), {
      timeoutMs: 3_000,
    });
    assert.equal(result.status, "failed");
    assert.equal(result.leads.length, 0);
    assert.ok(
      result.warnings.some((w) => /blocked/i.test(w)) ||
        result.errors.some((e) => /blocked/i.test(e)) ||
        /blocked/i.test(String(result.diagnostics?.safeMessage ?? "")),
    );
  });
});
