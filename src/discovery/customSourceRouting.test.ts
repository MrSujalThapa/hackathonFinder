import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isBlockedCustomSourceUrl,
  readGenericScraperV2Mode,
} from "@/discovery/genericScraperV2Mode";
import { readCustomSourceRuntimeMode } from "@/crawl/adapters/custom";

describe("custom source production routing", () => {
  it("always reports live/kernel for legacy mode reader", () => {
    assert.equal(readGenericScraperV2Mode({ GENERIC_SCRAPER_V2_MODE: "shadow" }), "live");
    assert.equal(readGenericScraperV2Mode({ GENERIC_SCRAPER_V2_MODE: "live" }), "live");
    assert.equal(readGenericScraperV2Mode({ GENERIC_SCRAPER_V2_MODE: "off" }), "live");
    assert.equal(readGenericScraperV2Mode({ GENERIC_SCRAPER_V2_MODE: "weird" }), "live");
    assert.equal(readCustomSourceRuntimeMode({}), "kernel");
  });

  it("classifies DoraHacks as blocked without network I/O", () => {
    assert.equal(isBlockedCustomSourceUrl("https://dorahacks.io/hackathon"), true);
    assert.equal(isBlockedCustomSourceUrl("https://hackathons.space/"), false);
  });
});
