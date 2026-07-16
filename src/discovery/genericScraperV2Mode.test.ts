import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectCustomSourceWithV2Routing,
  readGenericScraperV2Mode,
} from "@/discovery/genericScraperV2Mode";
import type { CustomSource } from "@/server/customSources/types";

describe("genericScraperV2Mode B4", () => {
  it("always reports live/kernel for legacy mode reader", () => {
    assert.equal(readGenericScraperV2Mode({ GENERIC_SCRAPER_V2_MODE: "shadow" }), "live");
    assert.equal(readGenericScraperV2Mode({ GENERIC_SCRAPER_V2_MODE: "live" }), "live");
    assert.equal(readGenericScraperV2Mode({ GENERIC_SCRAPER_V2_MODE: "off" }), "live");
    assert.equal(readGenericScraperV2Mode({ GENERIC_SCRAPER_V2_MODE: "weird" }), "live");
  });

  it("routes DoraHacks through kernel block path", async () => {
    const source: CustomSource = {
      id: "00000000-0000-4000-8000-000000000001",
      name: "DoraHacks",
      slug: "dorahacks",
      baseUrl: "https://dorahacks.io",
      listingUrl: "https://dorahacks.io/hackathon",
      mode: "auto",
      enabled: true,
      locationScope: "",
      topicScope: [],
      maxItems: 10,
      status: "unknown",
      lastCheckedAt: null,
      lastErrorSafe: null,
      selectors: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = await collectCustomSourceWithV2Routing(source, { timeoutMs: 3_000 });
    assert.equal(result.status, "failed");
  });
});
