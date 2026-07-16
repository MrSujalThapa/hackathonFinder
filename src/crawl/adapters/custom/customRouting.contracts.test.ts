import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CUSTOM_V1_SOAK_BLOCKER,
  isCustomSourceRollbackV1,
  isCustomSourceShadowEnabled,
  readCustomSourceRuntimeMode,
  warnDeprecatedCustomRoutingFlags,
} from "@/crawl/adapters/custom/routing";
import {
  collectCustomSourceWithV2Routing,
  readGenericScraperV2Mode,
} from "@/discovery/genericScraperV2Mode";
import type { CustomSource } from "@/server/customSources/types";

describe("custom routing kernel-only production path", () => {
  it("always resolves to kernel regardless of obsolete flags", () => {
    assert.equal(readCustomSourceRuntimeMode({}), "kernel");
    assert.equal(readCustomSourceRuntimeMode({ GENERIC_SCRAPER_V2_MODE: "off" }), "kernel");
    assert.equal(readCustomSourceRuntimeMode({ GENERIC_SCRAPER_V2_MODE: "shadow" }), "kernel");
    assert.equal(readCustomSourceRuntimeMode({ CUSTOM_SOURCE_ROLLBACK_V1: "1" }), "kernel");
    assert.equal(readCustomSourceRuntimeMode({ CUSTOM_SOURCE_SHADOW: "1" }), "kernel");
    assert.equal(readCustomSourceRuntimeMode({ CUSTOM_CRAWL_MODE: "rollback_v1" }), "kernel");
    assert.equal(isCustomSourceRollbackV1({ CUSTOM_SOURCE_ROLLBACK_V1: "1" }), false);
    assert.equal(isCustomSourceShadowEnabled({ CUSTOM_SOURCE_SHADOW: "1" }), false);
  });

  it("maps legacy GENERIC_SCRAPER_V2_MODE reader to live/kernel", () => {
    assert.equal(readGenericScraperV2Mode({ GENERIC_SCRAPER_V2_MODE: "off" }), "live");
    assert.equal(readGenericScraperV2Mode({ GENERIC_SCRAPER_V2_MODE: "shadow" }), "live");
    assert.equal(readGenericScraperV2Mode({ GENERIC_SCRAPER_V2_MODE: "weird" }), "live");
  });

  it("documents the V1 soak blocker", () => {
    assert.match(CUSTOM_V1_SOAK_BLOCKER, /soak/i);
    assert.match(CUSTOM_V1_SOAK_BLOCKER, /unreachable/i);
  });

  it("warns once for obsolete flags without throwing", () => {
    const messages: string[] = [];
    warnDeprecatedCustomRoutingFlags(
      { CUSTOM_SOURCE_SHADOW: "1" },
      (message) => messages.push(message),
    );
    assert.ok(messages.length <= 1);
  });

  it("pipeline entry remains collectCustomSourceWithV2Routing", async () => {
    const source: CustomSource = {
      id: "00000000-0000-4000-8000-000000000099",
      name: "DoraHacks",
      slug: "dorahacks",
      baseUrl: "https://dorahacks.io",
      listingUrl: "https://dorahacks.io/hackathon",
      mode: "static",
      enabled: true,
      locationScope: "",
      topicScope: [],
      maxItems: 20,
      status: "unknown",
      lastCheckedAt: null,
      lastErrorSafe: null,
      selectors: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = await collectCustomSourceWithV2Routing(source, {
      mode: "rollback_v1",
      timeoutMs: 5_000,
    });
    assert.equal(result.status, "failed");
    assert.ok(
      result.errors.some((error) => /blocked|human|verification/i.test(error)) ||
        result.warnings.some((warning) => /blocked/i.test(warning)),
    );
  });
});
