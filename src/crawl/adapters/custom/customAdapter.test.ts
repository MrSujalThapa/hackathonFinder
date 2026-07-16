import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCrawlPlan,
  isCustomCrawlPlan,
  shouldInvalidateAfterResult,
  structuralSignatureFromShape,
  validateCrawlPlan,
  CUSTOM_ADAPTER_VERSION,
  CUSTOM_CRAWL_PLAN_SCHEMA_VERSION,
} from "@/crawl/adapters/custom/crawlPlan";
import { CRAWL_KERNEL_VERSION } from "@/crawl/types";
import {
  isBlockedCustomSourceUrl,
  isOriginAllowed,
  originVariants,
} from "@/crawl/adapters/custom/origins";
import {
  isCustomSourceRollbackV1,
  readCustomSourceRuntimeMode,
} from "@/crawl/adapters/custom/routing";
import { extractListingCards } from "@/crawl/adapters/custom/extractCards";
import { listingCardToRawLead } from "@/crawl/adapters/custom/collect";
import { makeArtifact } from "@/crawl/adapters/custom/generic/acquisition";
import type { SourceExperiment } from "@/crawl/adapters/custom/generic/types";
import type { CustomSource } from "@/server/customSources/types";
import type { ListingCard } from "@/crawl/types";

describe("B4 custom routing defaults", () => {
  it("defaults to kernel, not V1", () => {
    assert.equal(readCustomSourceRuntimeMode({}), "kernel");
    assert.equal(readCustomSourceRuntimeMode({ GENERIC_SCRAPER_V2_MODE: "off" }), "kernel");
    assert.equal(readCustomSourceRuntimeMode({ GENERIC_SCRAPER_V2_MODE: "live" }), "kernel");
    assert.equal(readCustomSourceRuntimeMode({ GENERIC_SCRAPER_V2_MODE: "weird" }), "kernel");
  });

  it("obsolete rollback/shadow flags no longer select alternate runtimes", () => {
    assert.equal(readCustomSourceRuntimeMode({ CUSTOM_SOURCE_ROLLBACK_V1: "1" }), "kernel");
    assert.equal(readCustomSourceRuntimeMode({ CUSTOM_CRAWL_MODE: "rollback_v1" }), "kernel");
    assert.equal(isCustomSourceRollbackV1({ CUSTOM_SOURCE_ROLLBACK_V1: "true" }), false);
    assert.equal(readCustomSourceRuntimeMode({ CUSTOM_SOURCE_SHADOW: "1" }), "kernel");
    assert.equal(readCustomSourceRuntimeMode({ GENERIC_SCRAPER_V2_MODE: "shadow" }), "kernel");
  });

  it("invalid flag does not silently select V1", () => {
    assert.equal(readCustomSourceRuntimeMode({ CUSTOM_CRAWL_MODE: "garbage" }), "kernel");
    assert.equal(readCustomSourceRuntimeMode({ GENERIC_SCRAPER_V2_MODE: "" }), "kernel");
  });
});

describe("B2 origin and block safety", () => {
  it("allowlists www/apex variants", () => {
    const variants = originVariants("https://www.hackathons.space");
    assert.ok(variants.includes("https://www.hackathons.space"));
    assert.ok(variants.includes("https://hackathons.space"));
    assert.equal(isOriginAllowed("https://hackathons.space/page/2", variants), true);
    assert.equal(isOriginAllowed("https://evil.example/page", variants), false);
  });

  it("blocks DoraHacks without bypass", () => {
    assert.equal(isBlockedCustomSourceUrl("https://dorahacks.io/hackathon"), true);
    assert.equal(isBlockedCustomSourceUrl("https://www.hackathons.space/"), false);
  });
});

describe("B2 crawl-plan validation and invalidation", () => {
  const basePlan = buildCrawlPlan({
    mechanism: "next",
    allowedOrigins: originVariants("https://www.hackathons.space"),
    route: "/",
    structuralSignature: structuralSignatureFromShape({
      mechanism: "next",
      unitTag: "article",
      unitCount: 12,
      sampleTitles: ["A", "B"],
    }),
    observedInventory: 30,
    lastQuality: "healthy_complete",
    kernelVersion: CRAWL_KERNEL_VERSION,
  });

  it("accepts a matching plan", () => {
    assert.equal(isCustomCrawlPlan(basePlan), true);
    assert.equal(basePlan.schemaVersion, CUSTOM_CRAWL_PLAN_SCHEMA_VERSION);
    assert.equal(basePlan.adapterVersion, CUSTOM_ADAPTER_VERSION);
    const result = validateCrawlPlan({
      plan: basePlan,
      requestedUrl: "https://www.hackathons.space/",
      finalUrl: "https://www.hackathons.space/",
      allowedOrigins: basePlan.allowedOrigins,
      structuralSignature: basePlan.structuralSignature,
    });
    assert.equal(result.ok, true);
  });

  it("invalidates on origin change", () => {
    const result = validateCrawlPlan({
      plan: basePlan,
      requestedUrl: "https://www.hackathons.space/",
      finalUrl: "https://evil.example/",
      allowedOrigins: basePlan.allowedOrigins,
      structuralSignature: basePlan.structuralSignature,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "origin_or_redirect_change");
  });

  it("invalidates on structural drift", () => {
    const result = validateCrawlPlan({
      plan: basePlan,
      requestedUrl: "https://www.hackathons.space/",
      finalUrl: "https://www.hackathons.space/",
      allowedOrigins: basePlan.allowedOrigins,
      structuralSignature: "different-signature-000",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "missing_expected_structure");
  });

  it("invalidates on consecutive failure threshold", () => {
    const result = validateCrawlPlan({
      plan: { ...basePlan, consecutiveFailures: 3 },
      requestedUrl: "https://www.hackathons.space/",
      finalUrl: "https://www.hackathons.space/",
      allowedOrigins: basePlan.allowedOrigins,
      structuralSignature: basePlan.structuralSignature,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "consecutive_failure_threshold");
  });

  it("invalidates after blocked result against prior healthy inventory", () => {
    const reason = shouldInvalidateAfterResult({
      plan: basePlan,
      sourceState: "blocked_human_verification",
      stopReason: "blocked_human_verification",
      uniqueCards: 0,
    });
    assert.equal(reason, "blocked_human_verification");
  });

  it("invalidates repeated no-growth against healthy inventory", () => {
    const reason = shouldInvalidateAfterResult({
      plan: basePlan,
      sourceState: "usable_partial",
      stopReason: "no_growth",
      uniqueCards: 0,
    });
    assert.equal(reason, "repeated_no_growth_against_healthy_inventory");
  });
});

describe("B2 deterministic repeated-unit extraction", () => {
  it("extracts cards from clear repeated DOM without AI", async () => {
    const cards = Array.from({ length: 8 }, (_, index) => {
      const n = index + 1;
      return `<article class="event-card"><h2><a href="/events/hack-${n}">Hackathon ${n} Build</a></h2><time datetime="2026-0${(n % 9) + 1}-15">2026-0${(n % 9) + 1}-15</time><p>Location Remote</p></article>`;
    }).join("");
    const html = `<!doctype html><html><body><main>${cards}</main></body></html>`;
    const experiment: SourceExperiment = {
      inputUrl: "https://example.com/events",
      allowedOrigins: ["https://example.com"],
      maxRequests: 10,
      maxPages: 2,
      maxPayloadBytes: 1_000_000,
      browserAllowed: false,
      expectedContentCategory: "public_event_directory",
    };
    const artifact = makeArtifact({
      kind: "html",
      index: 0,
      sourceUrl: experiment.inputUrl,
      contentType: "text/html",
      payload: { title: "Events", bodyTextLength: html.length, html },
      rawBytes: Buffer.byteLength(html),
      acquisitionMode: "static",
      timingMs: 1,
    });
    const result = await extractListingCards({
      artifacts: [artifact],
      experiment,
      allowAiSelection: false,
    });
    assert.ok(result.cards.length >= 5, `expected >=5 cards, got ${result.cards.length}`);
    assert.equal(result.diagnostics.aiInvoked, false);
    assert.equal(result.diagnostics.aiUnavailable, false);
    assert.ok(result.diagnostics.strategy === "dom" || result.diagnostics.strategy === "structured");
  });

  it("does not treat registration labels as event titles or start dates", async () => {
    const cards = Array.from({ length: 6 }, (_, index) => {
      const n = index + 1;
      return `<article class="hack-card">
        <div class="badge">Registration Closed</div>
        <div class="meta">Registration Start: 2026-0${(n % 8) + 1}-10</div>
        <div class="meta">Registration End: 2026-0${(n % 8) + 1}-20</div>
        <h2><a href="/hack/event-${n}">Neural Build Challenge ${n}</a></h2>
        <span>online</span>
      </article>`;
    }).join("");
    const html = `<!doctype html><html><body><main>${cards}</main></body></html>`;
    const experiment: SourceExperiment = {
      inputUrl: "https://example.com/allhacks",
      allowedOrigins: ["https://example.com"],
      maxRequests: 10,
      maxPages: 2,
      maxPayloadBytes: 1_000_000,
      browserAllowed: false,
      expectedContentCategory: "public_event_directory",
    };
    const artifact = makeArtifact({
      kind: "html",
      index: 0,
      sourceUrl: experiment.inputUrl,
      contentType: "text/html",
      payload: { title: "All hacks", bodyTextLength: html.length, html },
      rawBytes: Buffer.byteLength(html),
      acquisitionMode: "static",
      timingMs: 1,
    });
    const result = await extractListingCards({
      artifacts: [artifact],
      experiment,
      allowAiSelection: false,
    });
    assert.ok(result.cards.length >= 5, `expected >=5 cards, got ${result.cards.length}`);
    for (const card of result.cards) {
      assert.doesNotMatch(card.title, /^Registration\s+(Start|End|Closed)/i);
      assert.match(card.title, /Neural Build Challenge/i);
      // Registration dates must not become event start dates.
      assert.equal(card.startDate, undefined);
      assert.ok(card.deadline, "registration end should map to deadline");
      assert.equal(card.evidence?.statusText, "closed");
    }
  });

  it("falls back to slug title when only status chrome is present", async () => {
    const cards = Array.from({ length: 5 }, (_, index) => {
      const n = index + 1;
      return `<article class="hack-card">
        <a href="/hack/aurora-build-${n}">Registration Closed</a>
        <div>Registration Start: 2026-0${(n % 8) + 1}-05</div>
        <div>Registration End: 2026-0${(n % 8) + 1}-15</div>
      </article>`;
    }).join("");
    const html = `<!doctype html><html><body><main>${cards}</main></body></html>`;
    const experiment: SourceExperiment = {
      inputUrl: "https://example.com/allhacks",
      allowedOrigins: ["https://example.com"],
      maxRequests: 10,
      maxPages: 2,
      maxPayloadBytes: 1_000_000,
      browserAllowed: false,
      expectedContentCategory: "public_event_directory",
    };
    const artifact = makeArtifact({
      kind: "html",
      index: 0,
      sourceUrl: experiment.inputUrl,
      contentType: "text/html",
      payload: { title: "All hacks", bodyTextLength: html.length, html },
      rawBytes: Buffer.byteLength(html),
      acquisitionMode: "static",
      timingMs: 1,
    });
    const result = await extractListingCards({
      artifacts: [artifact],
      experiment,
      allowAiSelection: false,
    });
    assert.ok(result.cards.length >= 4, `expected >=4 cards, got ${result.cards.length}`);
    for (const card of result.cards) {
      assert.doesNotMatch(card.title, /Registration Closed/i);
      assert.match(card.title, /Aurora Build/i);
      assert.equal(card.startDate, undefined);
      assert.ok(card.deadline);
    }
  });

  it("maps registration deadline and closed status onto raw lead fields", () => {
    const source: CustomSource = {
      id: "00000000-0000-4000-8000-00000000c4t1",
      name: "Example",
      slug: "example",
      baseUrl: "https://example.com",
      listingUrl: "https://example.com/allhacks",
      mode: "auto",
      enabled: true,
      locationScope: "global",
      topicScope: ["hackathon"],
      maxItems: 40,
      status: "unknown",
      lastCheckedAt: null,
      lastErrorSafe: null,
      selectors: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const card: ListingCard = {
      identity: "https://example.com/hack/aurora",
      title: "Aurora Build Challenge",
      url: "https://example.com/hack/aurora",
      deadline: "2026-08-01T00:00:00.000Z",
      modeHint: "remote",
      evidence: {
        statusText: "closed",
        shortDescription: "Registration start: 2026-07-01 · Registration end: 2026-08-01",
        locationText: "online",
      },
    };
    const lead = listingCardToRawLead(source, card);
    assert.equal(lead.metadata?.startDate, undefined);
    assert.equal(lead.metadata?.endDate, undefined);
    assert.equal(lead.metadata?.deadline, "2026-08-01T00:00:00.000Z");
    assert.equal(lead.metadata?.applicationDeadline, "2026-08-01T00:00:00.000Z");
    assert.equal(lead.metadata?.status, "closed");
    assert.match(String(lead.url), /\/hack\/aurora$/);
  });
});
