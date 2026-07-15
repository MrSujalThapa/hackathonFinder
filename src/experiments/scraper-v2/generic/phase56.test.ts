import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { enumerateCandidateActionsFromHtml } from "@/experiments/scraper-v2/generic/browserActions";
import { estimateAvailableEventCount } from "@/experiments/scraper-v2/generic/coverageEstimate";
import { runGenericDomExtraction } from "@/experiments/scraper-v2/generic/domExtraction";
import { evaluateGenericExtractionQuality } from "@/experiments/scraper-v2/generic/quality";
import type { AcquiredArtifact, GenericShadowLead, SourceExperiment } from "@/experiments/scraper-v2/generic/types";

const experiment: SourceExperiment = {
  inputUrl: "https://events.example/",
  allowedOrigins: ["https://events.example"],
  maxRequests: 20,
  maxPages: 4,
  maxBrowserActions: 3,
  maxPayloadBytes: 500_000,
  browserAllowed: true,
  expectedContentCategory: "public_event_directory",
  expectedMinimumEventCount: 190,
};

function lead(title: string, index: number): GenericShadowLead {
  return {
    sourceUrl: experiment.inputUrl,
    artifactKind: "dom_snapshot",
    title,
    canonicalUrl: `https://events.example/events/${index}`,
    sourceRecordId: `event-${index}`,
    startDate: "2026-08-01T00:00:00.000Z",
    normalizedStatus: "open",
    statusInference: "fixture",
    confidence: 0.9,
  };
}

function artifact(kind: AcquiredArtifact["kind"], payload: unknown, index = 0): AcquiredArtifact {
  return {
    artifactId: `${kind}:${index}`,
    kind,
    sourceUrl: experiment.inputUrl,
    payload,
    byteSize: JSON.stringify(payload).length,
    acquisitionMode: kind === "dom_snapshot" ? "browser" : "static",
    timingMs: 1,
  };
}

function cards(start: number, count: number): string {
  return Array.from({ length: count }, (_item, offset) => {
    const index = start + offset;
    return `<article class="event-card"><a href="/events/${index}"><h2>Build Challenge ${index}</h2></a><p>Aug ${index}, 2026</p><p>Online</p></article>`;
  }).join("");
}

describe("phase 5.6 coverage and pagination correctness", () => {
  it("excludes historical/test minimums from live available-count estimates", () => {
    const leads = Array.from({ length: 12 }, (_item, index) => lead(`Event ${index}`, index));
    const estimate = estimateAvailableEventCount({ artifacts: [], leads });
    const quality = evaluateGenericExtractionQuality({
      discoveredRecords: 12,
      leads,
      experiment,
      availableEstimate: estimate,
    });

    assert.equal(quality.estimatedAvailableRecords, 12);
    assert.notEqual(quality.estimatedAvailableRecords, experiment.expectedMinimumEventCount);
    assert.equal(quality.availableEstimateMethod, "inferred");
  });

  it("prioritizes event-like API totals and records contradictory visible counts", () => {
    const estimate = estimateAvailableEventCount({
      artifacts: [
        artifact("network_json", { total: 40, records: [{ title: "AI Hackathon", deadline: "2026-08-01" }] }),
        artifact("html", { html: "<main>12 hackathons</main>" }),
      ],
      leads: Array.from({ length: 12 }, (_item, index) => lead(`Event ${index}`, index)),
    });

    assert.equal(estimate.estimatedAvailableRecords, 40);
    assert.equal(estimate.method, "api_total");
    assert.equal(estimate.confidence, "authoritative");
    assert.ok(estimate.contradictions.some((message) => /api_total=40.*visible_count=12/.test(message)));
  });

  it("uses pagination-derived exhausted counts instead of inflated visual metadata", () => {
    const html = `<main>${cards(1, 12)}<nav><button aria-current="page">1</button><button>2</button><button>3</button><button aria-label="Next page">Next</button></nav></main>`;
    const leads = Array.from({ length: 30 }, (_item, index) => lead(`Event ${index}`, index));
    const estimate = estimateAvailableEventCount({
      artifacts: [
        artifact("dom_snapshot", { html, visualNodes: Array.from({ length: 190 }, (_item, index) => ({ nodeId: index, text: "box" })) }),
      ],
      leads,
      diagnostics: { finalUrl: experiment.inputUrl, attemptedLayers: [], skippedLayers: [], requestsMade: 1, browserPages: 3, bytesInspected: html.length, rssLinks: [], sitemapLinks: [], paginationStopReason: "no_growth" },
    });

    assert.equal(estimate.estimatedAvailableRecords, 30);
    assert.equal(estimate.method, "pagination_derived");
    assert.equal(estimate.confidence, "strong");
  });

  it("uses visible event-like table rows as a live source-total signal", () => {
    const rows = Array.from({ length: 25 }, (_item, index) =>
      `<tr><td>Hackathon ${index}</td><td>Online</td><td>Aug ${index + 1}, 2026</td></tr>`,
    ).join("");
    const estimate = estimateAvailableEventCount({
      artifacts: [artifact("html", { html: `<table><tbody>${rows}</tbody></table>` })],
      leads: [lead("Recovered", 1), lead("Recovered Two", 2), lead("Recovered Three", 3)],
    });

    assert.equal(estimate.estimatedAvailableRecords, 25);
    assert.equal(estimate.method, "visible_count");
  });

  it("classifies WAF challenges and stale routes explicitly", () => {
    const blocked = evaluateGenericExtractionQuality({
      discoveredRecords: 0,
      leads: [],
      experiment,
      blockedReason: "human_verification",
    });
    const stale = evaluateGenericExtractionQuality({
      discoveredRecords: 0,
      leads: [],
      experiment,
      blockedReason: "static response returned 404",
    });

    assert.equal(blocked.classification, "blocked_human_verification");
    assert.equal(stale.classification, "stale_or_missing_route");
  });

  it("prefers concrete Next controls and disables current numbered pages without synthetic scroll", () => {
    const actions = enumerateCandidateActionsFromHtml(
      `<main>${cards(1, 12)}<nav><button aria-current="page">1</button><button>2</button><button aria-label="Next page">Next</button></nav></main>`,
      experiment.inputUrl,
    );

    assert.equal(actions.some((action) => action.elementId === "synthetic:scroll"), false);
    assert.equal(actions.some((action) => action.accessibleName === "1"), false);
    assert.equal(actions[0]?.accessibleName, "Next page");
    assert.equal(actions[0]?.proposedEffect, "next_page");
  });

  it("aggregates compatible DOM unit sets across captured pages and dedupes identities", () => {
    const result = runGenericDomExtraction([
      artifact("dom_snapshot", { title: "Page 1", html: `<main><section>${cards(1, 3)}</section></main>` }, 0),
      artifact("dom_snapshot", { title: "Page 2", html: `<main><section>${cards(4, 3)}</section></main>` }, 1),
      artifact("dom_snapshot", { title: "Page 3", html: `<main><section>${cards(1, 2)}</section></main>` }, 2),
    ], experiment);

    assert.equal(result.leads.length, 6);
    assert.equal(result.availableRecords, 8);
    assert.deepEqual(result.leads.map((item) => item.title).slice(0, 2), ["Build Challenge 1", "Build Challenge 2"]);
  });

  it("keeps Phase 5.6 generic and persistence-free", async () => {
    const content = (await Promise.all([
      "src/experiments/scraper-v2/generic/acquisition.ts",
      "src/experiments/scraper-v2/generic/browserActions.ts",
      "src/experiments/scraper-v2/generic/coverageEstimate.ts",
      "src/experiments/scraper-v2/generic/domExtraction.ts",
      "src/experiments/scraper-v2/generic/quality.ts",
    ].map((file) => readFile(file, "utf8")))).join("\n");

    assert.doesNotMatch(content, /\b(?:dorahacks|hackathons\.space|eventornado|devpost|mlh|garage48|eventbrite|hackathonradar)\b/i);
    assert.doesNotMatch(content, /supabase|candidateRepository|persistCandidate|googleapis|Queue mutation|source health/i);
  });
});
