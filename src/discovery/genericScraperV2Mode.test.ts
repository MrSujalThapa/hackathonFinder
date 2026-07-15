import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  customSourceToExperiment,
  genericLeadToRawLead,
  isBlockedCustomSourceUrl,
  originVariants,
  readGenericScraperV2Mode,
} from "@/discovery/genericScraperV2Mode";
import type { CustomSource } from "@/server/customSources/types";
import type { GenericShadowLead } from "@/experiments/scraper-v2/generic/types";

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

describe("generic scraper v2 routing guards", () => {
  it("defaults GENERIC_SCRAPER_V2_MODE to off", () => {
    assert.equal(readGenericScraperV2Mode({}), "off");
    assert.equal(readGenericScraperV2Mode({ GENERIC_SCRAPER_V2_MODE: "shadow" }), "shadow");
    assert.equal(readGenericScraperV2Mode({ GENERIC_SCRAPER_V2_MODE: "live" }), "live");
    assert.equal(readGenericScraperV2Mode({ GENERIC_SCRAPER_V2_MODE: "weird" }), "off");
  });

  it("blocks DoraHacks without bypass", () => {
    assert.equal(isBlockedCustomSourceUrl("https://dorahacks.io/hackathon"), true);
    assert.equal(isBlockedCustomSourceUrl("https://www.hackathons.space/"), false);
    assert.equal(isBlockedCustomSourceUrl("https://eventornado.com/events"), false);
  });

  it("builds experiments for configured custom validation targets", () => {
    const space = customSourceToExperiment(customSource());
    assert.equal(space.inputUrl, "https://www.hackathons.space/");
    assert.ok((space.expectedMinimumEventCount ?? 0) >= 20);
    assert.deepEqual(
      space.allowedOrigins,
      originVariants("https://www.hackathons.space"),
    );
    assert.equal(space.maxPayloadBytes, 5_000_000);
    assert.equal(space.maxPages, 3);
    assert.equal(space.maxBrowserActions, 3);
    assert.ok(space.allowedOrigins.includes("https://hackathons.space"));

    const eventornado = customSourceToExperiment(
      customSource({
        slug: "eventornado",
        listingUrl: "https://eventornado.com/events",
        baseUrl: "https://eventornado.com",
      }),
    );
    assert.equal(eventornado.inputUrl, "https://eventornado.com/events");
    assert.ok(eventornado.allowedOrigins.includes("https://www.eventornado.com"));
  });

  it("maps V2 leads onto the normal RawLead pipeline shape", () => {
    const lead: GenericShadowLead = {
      sourceUrl: "https://www.hackathons.space/",
      artifactKind: "html",
      title: "Space AI Hack",
      canonicalUrl: "https://www.hackathons.space/events/space-ai",
      startDate: "2026-08-01",
      deadline: "2026-07-20",
      location: "Remote",
      mode: "online",
      description: "AI hackathon",
      normalizedStatus: "upcoming",
      statusInference: "from_dates",
      confidence: 0.9,
    };
    const raw = genericLeadToRawLead(customSource(), lead);
    assert.equal(raw.source, "custom:hackathons-space");
    assert.equal(raw.metadata?.provenance, "custom_site_v2");
    assert.equal(raw.metadata?.discoveryMode, "generic_scraper_v2");
    assert.equal(raw.url, "https://www.hackathons.space/events/space-ai");
  });
});
