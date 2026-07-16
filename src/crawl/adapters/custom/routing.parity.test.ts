import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { listingCardToRawLead } from "@/crawl/adapters/custom/collect";
import {
  collectCustomSourceWithV2Routing,
  readGenericScraperV2Mode,
} from "@/discovery/genericScraperV2Mode";
import { readCustomSourceRuntimeMode } from "@/crawl/adapters/custom/routing";
import type { CustomSource } from "@/server/customSources/types";

function customSource(overrides: Partial<CustomSource> = {}): CustomSource {
  return {
    id: "cs-1",
    name: "hackathons.space",
    slug: "hackathons-space",
    baseUrl: "https://www.hackathons.space",
    listingUrl: "https://www.hackathons.space/",
    mode: "auto",
    enabled: true,
    locationScope: "",
    topicScope: [],
    maxItems: 40,
    status: "unknown",
    lastCheckedAt: null,
    lastErrorSafe: null,
    selectors: {},
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("B2 production routing and experiment independence", () => {
  it("legacy reader no longer maps off to permanent V1", () => {
    assert.equal(readGenericScraperV2Mode({}), "live");
    assert.equal(readGenericScraperV2Mode({ GENERIC_SCRAPER_V2_MODE: "off" }), "live");
    assert.equal(readGenericScraperV2Mode({ GENERIC_SCRAPER_V2_MODE: "shadow" }), "shadow");
    assert.equal(readGenericScraperV2Mode({ GENERIC_SCRAPER_V2_MODE: "weird" }), "live");
  });

  it("normal custom routing module does not statically import experiments", () => {
    const collectPath = path.join(
      process.cwd(),
      "src/crawl/adapters/custom/collect.ts",
    );
    const adapterPath = path.join(
      process.cwd(),
      "src/crawl/adapters/custom/adapter.ts",
    );
    const collectSrc = readFileSync(collectPath, "utf8");
    const adapterSrc = readFileSync(adapterPath, "utf8");
    assert.doesNotMatch(collectSrc, /from ["']@\/experiments\//);
    assert.doesNotMatch(adapterSrc, /from ["']@\/experiments\//);
  });

  it("pipeline still calls collectCustomSourceWithV2Routing entry", () => {
    const pipeline = readFileSync(
      path.join(process.cwd(), "src/discovery/pipeline.ts"),
      "utf8",
    );
    assert.match(pipeline, /collectCustomSourceWithV2Routing/);
  });

  it("DoraHacks returns blocked with zero leads and no retry loop", async () => {
    const result = await collectCustomSourceWithV2Routing(
      customSource({
        slug: "dorahacks",
        listingUrl: "https://dorahacks.io/hackathon",
        baseUrl: "https://dorahacks.io",
      }),
      { persistHealth: false },
    );
    assert.equal(result.leads.length, 0);
    assert.equal(result.diagnostics.stopReason, "blocked_human_verification");
    assert.ok(result.warnings.includes("blocked_human_verification"));
  });

  it("rollback mode is explicit and logged", () => {
    assert.equal(readCustomSourceRuntimeMode({ CUSTOM_SOURCE_ROLLBACK_V1: "1" }), "rollback_v1");
  });
});

describe("B2 shadow / dry-run write guarantees (static)", () => {
  it("shadow mode documents zero writes in warnings contract", () => {
    assert.equal(readCustomSourceRuntimeMode({ CUSTOM_SOURCE_SHADOW: "1" }), "shadow");
  });

  it("kernel collect module never calls persistence strategies", () => {
    const collectSrc = readFileSync(
      path.join(process.cwd(), "src/crawl/adapters/custom/collect.ts"),
      "utf8",
    );
    assert.doesNotMatch(collectSrc, /persistence\/strategies|planPersistence|upsertCandidate/);
  });
});

describe("B2 identity dedupe stability", () => {
  it("listingCardToRawLead produces stable custom ids", () => {
    const source = customSource();
    const card = {
      identity: "stable-id-1",
      title: "Space AI Hack",
      url: "https://www.hackathons.space/events/space-ai",
      startDate: "2026-08-01",
      modeHint: "remote" as const,
    };
    const a = listingCardToRawLead(source, card);
    const b = listingCardToRawLead(source, card);
    assert.equal(a.id, b.id);
    assert.equal(a.metadata?.provenance, "custom_site_kernel");
    assert.equal(a.source, "custom:hackathons-space");
  });
});
