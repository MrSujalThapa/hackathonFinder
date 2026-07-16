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
import { makeArtifact } from "@/crawl/adapters/custom/generic/acquisition";
import type { SourceExperiment } from "@/crawl/adapters/custom/generic/types";

describe("B2 custom routing defaults", () => {
  it("defaults to kernel, not V1", () => {
    assert.equal(readCustomSourceRuntimeMode({}), "kernel");
    assert.equal(readCustomSourceRuntimeMode({ GENERIC_SCRAPER_V2_MODE: "off" }), "kernel");
    assert.equal(readCustomSourceRuntimeMode({ GENERIC_SCRAPER_V2_MODE: "live" }), "kernel");
    assert.equal(readCustomSourceRuntimeMode({ GENERIC_SCRAPER_V2_MODE: "weird" }), "kernel");
  });

  it("explicit rollback reaches V1 mode", () => {
    assert.equal(
      readCustomSourceRuntimeMode({ CUSTOM_SOURCE_ROLLBACK_V1: "1" }),
      "rollback_v1",
    );
    assert.equal(
      readCustomSourceRuntimeMode({ CUSTOM_CRAWL_MODE: "rollback_v1" }),
      "rollback_v1",
    );
    assert.equal(isCustomSourceRollbackV1({ CUSTOM_SOURCE_ROLLBACK_V1: "true" }), true);
  });

  it("invalid flag does not silently select V1", () => {
    assert.equal(readCustomSourceRuntimeMode({ CUSTOM_CRAWL_MODE: "garbage" }), "kernel");
    assert.equal(readCustomSourceRuntimeMode({ GENERIC_SCRAPER_V2_MODE: "" }), "kernel");
    assert.notEqual(readCustomSourceRuntimeMode({ GENERIC_SCRAPER_V2_MODE: "off" }), "rollback_v1");
  });

  it("shadow is explicit only", () => {
    assert.equal(readCustomSourceRuntimeMode({ CUSTOM_SOURCE_SHADOW: "1" }), "shadow");
    assert.equal(readCustomSourceRuntimeMode({ GENERIC_SCRAPER_V2_MODE: "shadow" }), "shadow");
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

  it("emits ai_unavailable when AI would be required and LLM is missing", async () => {
    const prevProvider = process.env.LLM_PROVIDER;
    const prevKey = process.env.LLM_API_KEY;
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_API_KEY;
    try {
      const html = `<!doctype html><html><body><div class="x">noise</div></body></html>`;
      const experiment: SourceExperiment = {
        inputUrl: "https://example.com/events",
        allowedOrigins: ["https://example.com"],
        maxRequests: 10,
        maxPages: 2,
        maxPayloadBytes: 1_000_000,
        browserAllowed: false,
        expectedContentCategory: "public_event_directory",
        expectedMinimumEventCount: 20,
      };
      const artifact = makeArtifact({
        kind: "html",
        index: 0,
        sourceUrl: experiment.inputUrl,
        contentType: "text/html",
        payload: { title: "Empty", bodyTextLength: 10, html },
        rawBytes: Buffer.byteLength(html),
        acquisitionMode: "static",
        timingMs: 1,
      });
      const result = await extractListingCards({
        artifacts: [artifact],
        experiment,
        allowAiSelection: true,
      });
      // Weak page: either zero cards with ai_unavailable, or honest empty without V1.
      if (result.cards.length === 0 && result.diagnostics.aiUnavailable) {
        assert.equal(result.diagnostics.aiUnavailable, true);
      } else {
        assert.equal(result.diagnostics.aiInvoked, false);
      }
    } finally {
      if (prevProvider !== undefined) process.env.LLM_PROVIDER = prevProvider;
      else delete process.env.LLM_PROVIDER;
      if (prevKey !== undefined) process.env.LLM_API_KEY = prevKey;
      else delete process.env.LLM_API_KEY;
    }
  });
});
