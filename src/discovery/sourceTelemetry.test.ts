import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CollectorResult } from "@/collectors/types";
import type { SourceRunStats } from "@/core/discovery/types";
import {
  SOURCE_TELEMETRY_MAX_ITEM_BYTES,
  buildSourceTelemetry,
  clampSourceTelemetry,
  compactSourceStatsForSummary,
  estimateJsonBytes,
  inferInventoryEstimate,
  legacySourceStatsPayload,
} from "@/discovery/sourceTelemetry";

function stats(partial: Partial<SourceRunStats> = {}): SourceRunStats {
  return {
    source: "devpost",
    leadsFound: 405,
    queueReady: 10,
    needsReview: 2,
    invalidRejected: 5,
    accepted: 12,
    rejected: 5,
    errors: [],
    warnings: ["stop_reason=maximum_cards_reached"],
    durationMs: 8_000,
    outcome: "executed",
    ...partial,
  };
}

function result(partial: Partial<CollectorResult> = {}): CollectorResult {
  return {
    source: "devpost",
    status: "completed",
    leads: [],
    warnings: [
      "acquisition_scope=full_directory_api",
      "stop_reason=maximum_cards_reached",
      "stop_evidence=safety_card_budget_reached_not_source_exhaustion",
    ],
    errors: [],
    durationMs: 7_500,
    diagnostics: {
      discovered: 405,
      returned: 405,
      enriched: 12,
      partial: 0,
      dropped: 0,
      stopReason: "maximum_cards_reached",
    },
    metrics: {
      uniqueCards: 405,
      pagesFetched: 45,
      detailPagesOpened: 12,
      metaTotalCount: 13_601,
      listingDurationMs: 5_000,
      detailDurationMs: 2_500,
    },
    ...partial,
  };
}

describe("sourceTelemetry", () => {
  it("labels full-directory inventory from meta.total_count with acquisition scope", () => {
    const inventory = inferInventoryEstimate("devpost", result());
    assert.deepEqual(inventory, {
      value: 13_601,
      method: "api_total",
      confidence: "strong",
    });
    const telemetry = buildSourceTelemetry({
      stats: stats(),
      result: result({
        warnings: [
          "acquisition_scope=full_directory_api",
          "stop_reason=maximum_cards_reached",
          "stop_evidence=safety_card_budget_reached_not_source_exhaustion",
          "target_for_profile=300",
          "target_reached=true",
          "directory_reported_total=13601",
        ],
        metrics: {
          uniqueCards: 405,
          pagesFetched: 45,
          detailPagesOpened: 12,
          metaTotalCount: 13_601,
          directoryReportedTotal: 13_601,
          targetForProfile: 300,
          targetReached: 1,
          listingDurationMs: 5_000,
          detailDurationMs: 2_500,
        },
      }),
    });
    assert.equal(telemetry.acquisitionScope, "full_directory_api");
    assert.equal(telemetry.stopEvidence, "safety_card_budget_reached_not_source_exhaustion");
    assert.equal(telemetry.observedDirectoryInventory?.value, 13_601);
    assert.equal(telemetry.directoryReportedTotal, 13_601);
    assert.equal(telemetry.targetForProfile, 300);
    assert.equal(telemetry.targetReached, true);
  });

  it("distinguishes target_reached from budget and exhaustion stops", () => {
    const telemetry = buildSourceTelemetry({
      stats: stats({ leadsFound: 75 }),
      result: result({
        warnings: [
          "acquisition_scope=full_directory_api",
          "stop_reason=target_reached",
          "stop_evidence=profile_target_reached:75",
          "target_for_profile=75",
          "target_reached=true",
          "directory_reported_total=13601",
        ],
        diagnostics: {
          discovered: 75,
          returned: 75,
          enriched: 0,
          partial: 0,
          dropped: 0,
          stopReason: "target_reached",
        },
        metrics: {
          uniqueCards: 75,
          pagesFetched: 9,
          detailPagesOpened: 4,
          metaTotalCount: 13_601,
          directoryReportedTotal: 13_601,
          targetForProfile: 75,
          targetReached: 1,
        },
      }),
    });
    assert.equal(telemetry.stopReason, "target_reached");
    assert.match(telemetry.stopEvidence, /profile_target_reached:75/);
    assert.equal(telemetry.targetReached, true);
    assert.equal(telemetry.collectedUnique, 75);
  });

  it("does not treat Luma feed provenance as content-theme relevance", () => {
    const telemetry = buildSourceTelemetry({
      stats: stats({ source: "luma", leadsFound: 121, accepted: 0 }),
      result: {
        source: "luma",
        status: "completed",
        leads: [],
        warnings: [
          "acquisition_scope=multi_feed_public_events",
          "classified_hackathon=2",
          "feed_theme_candidate=48",
          "content_theme_matched=5",
          "theme_relevant=5",
          "query_relevant_estimate=1",
        ],
        errors: [],
        durationMs: 90_000,
        diagnostics: {
          discovered: 121,
          returned: 121,
          enriched: 10,
          partial: 0,
          dropped: 0,
          stopReason: "no_growth",
        },
        metrics: {
          uniqueCards: 121,
          classifiedHackathon: 2,
          feedThemeCandidate: 48,
          contentThemeMatched: 5,
          themeRelevant: 5,
          queryRelevant: 1,
        },
      },
    });
    assert.equal(telemetry.collectedUnique, 121);
    assert.equal(telemetry.feedThemeCandidate, 48);
    assert.equal(telemetry.contentThemeMatched, 5);
    assert.equal(telemetry.themeRelevant, 5);
    assert.equal(telemetry.classifiedHackathon, 2);
    assert.equal(telemetry.queryRelevant, 1);
    assert.notEqual(telemetry.themeRelevant, telemetry.feedThemeCandidate);
  });

  it("keeps open+upcoming subset scope distinct from full directory", () => {
    const subset = result({
      warnings: [
        "acquisition_scope=open_upcoming_api_subset",
        "stop_reason=no_next_page",
        "stop_evidence=api_meta_total_count_reached:166",
        "page_1_requested=https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&page=1",
      ],
      diagnostics: {
        discovered: 166,
        returned: 166,
        enriched: 0,
        partial: 0,
        dropped: 0,
        stopReason: "no_next_page",
      },
      metrics: {
        uniqueCards: 166,
        pagesFetched: 19,
        metaTotalCount: 166,
      },
    });
    const telemetry = buildSourceTelemetry({
      stats: stats({ leadsFound: 166, accepted: 0 }),
      result: subset,
    });
    assert.equal(telemetry.acquisitionScope, "open_upcoming_api_subset");
    assert.equal(telemetry.observedDirectoryInventory?.value, 166);
  });

  it("never exposes inventory without method/confidence and clamps item bytes", () => {
    const telemetry = buildSourceTelemetry({
      stats: stats({
        warnings: ["x".repeat(400)],
        errors: ["y".repeat(400)],
      }),
      result: result({
        errors: ["z".repeat(400)],
      }),
    });
    assert.ok(telemetry.observedDirectoryInventory);
    assert.equal(typeof telemetry.observedDirectoryInventory.method, "string");
    assert.equal(typeof telemetry.observedDirectoryInventory.confidence, "string");
    assert.ok(estimateJsonBytes(telemetry) <= SOURCE_TELEMETRY_MAX_ITEM_BYTES);

    const bloated = clampSourceTelemetry({
      ...telemetry,
      requestedUrl: "https://example.com/" + "a".repeat(2_000),
      finalUrl: "https://example.com/" + "b".repeat(2_000),
      failureClassification: "c".repeat(500),
    });
    assert.ok(estimateJsonBytes(bloated) <= SOURCE_TELEMETRY_MAX_ITEM_BYTES);
  });

  it("compacts summary rows and shrinks vs legacy warning dumps", () => {
    const row = stats({
      warnings: Array.from({ length: 20 }, (_, i) => `fingerprint dump ${i} ${"x".repeat(80)}`),
      errors: ["network flake"],
    });
    row.telemetry = buildSourceTelemetry({ stats: row, result: result() });
    const before = estimateJsonBytes(legacySourceStatsPayload([row]));
    const after = estimateJsonBytes(compactSourceStatsForSummary([row]));
    assert.ok(after < before, `expected after ${after} < before ${before}`);
    const compact = compactSourceStatsForSummary([row])[0]!;
    assert.equal(compact.acquisitionScope, "full_directory_api");
    assert.equal(compact.stopEvidence, "safety_card_budget_reached_not_source_exhaustion");
  });
});
