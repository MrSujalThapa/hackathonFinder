import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { dedupeLeadsByIdentity, identityForLead } from "@/experiments/scraper-v2/generic/adaptiveIdentity";
import { buildCrawlPlan } from "@/experiments/scraper-v2/generic/adaptiveProfiles";
import { runAdaptiveCrawl, scheduleAdaptiveSources } from "@/experiments/scraper-v2/generic/adaptiveCrawler";
import { summarizeDateCoverage, decideCrawlContinuation } from "@/experiments/scraper-v2/generic/dateCoverage";
import { understandPageArtifacts, shouldInvokeAiOrVision } from "@/experiments/scraper-v2/generic/pageUnderstanding";
import type { AcquiredArtifact, GenericShadowLead, SourceExperiment } from "@/experiments/scraper-v2/generic/types";

function source(url: string, expectedMinimumEventCount = 0): SourceExperiment {
  const parsed = new URL(url);
  return {
    inputUrl: url,
    allowedOrigins: [parsed.origin],
    maxRequests: 30,
    maxPages: 4,
    maxBrowserActions: 2,
    maxPayloadBytes: 500_000,
    browserAllowed: false,
    expectedContentCategory: "public_event_directory",
    expectedMinimumEventCount: expectedMinimumEventCount || undefined,
  };
}

function records(prefix: string, count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_value, index) => ({
    id: `${prefix}-${index}`,
    title: `${prefix} Hackathon ${index}`,
    href: `/${prefix}-${index}`,
    starts_at: `2026-${String(8 + (index % 4)).padStart(2, "0")}-01`,
    location: "Online",
    status: "open",
  }));
}

function htmlFor(prefix: string, count: number): string {
  return `<!doctype html><html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { events: records(prefix, count) } },
  })}</script></html>`;
}

function lead(input: Partial<GenericShadowLead> & Pick<GenericShadowLead, "title">): GenericShadowLead {
  return {
    sourceUrl: "https://events.example",
    artifactKind: "next_data",
    normalizedStatus: "open",
    statusInference: "test",
    confidence: 0.9,
    ...input,
  };
}

function artifact(html: string): AcquiredArtifact {
  return {
    artifactId: "dom_snapshot:1",
    kind: "dom_snapshot",
    sourceUrl: "https://events.example",
    payload: { html, title: "Events", textLength: html.length },
    byteSize: html.length,
    acquisitionMode: "browser",
    timingMs: 1,
  };
}

describe("phase 5.3 adaptive crawler", () => {
  it("infers materially different light, standard, deep, and exhaustive crawl plans", () => {
    const light = buildCrawlPlan({ query: "find 50 hackathons fast" });
    const standard = buildCrawlPlan({ query: "find 150 hackathons" });
    const deep = buildCrawlPlan({ query: "deep crawl 500+ hackathons" });
    const exhaustive = buildCrawlPlan({ query: "exhaustive all public hackathons" });

    assert.equal(light.profile, "light");
    assert.equal(standard.profile, "standard");
    assert.equal(deep.profile, "deep");
    assert.equal(exhaustive.profile, "exhaustive");
    assert.ok(light.maxPagesPerSource < standard.maxPagesPerSource);
    assert.ok(standard.maxPagesPerSource < deep.maxPagesPerSource);
    assert.ok(deep.maxPagesPerSource < exhaustive.maxPagesPerSource);
    assert.ok(light.targetValidEvents < standard.targetValidEvents);
    assert.ok(standard.targetValidEvents < deep.targetValidEvents);
  });

  it("makes date horizons first-class crawl planning inputs", () => {
    const twoWeeks = buildCrawlPlan({ query: "hackathons next 2 weeks" });
    const sixMonths = buildCrawlPlan({ query: "hackathons next 6 months" });
    assert.ok(twoWeeks.dateHorizonEnd);
    assert.ok(sixMonths.dateHorizonEnd);
    assert.ok(new Date(sixMonths.dateHorizonEnd!).getTime() > new Date(twoWeeks.dateHorizonEnd!).getTime());

    const coverage = summarizeDateCoverage({
      leads: [
        lead({ title: "Soon Hack", startDate: twoWeeks.dateHorizonStart }),
        lead({ title: "Later Hack", startDate: twoWeeks.dateHorizonEnd }),
      ],
      rawRecords: 2,
      dateHorizonStart: twoWeeks.dateHorizonStart,
      dateHorizonEnd: twoWeeks.dateHorizonEnd,
    });
    assert.equal(coverage.inHorizonEvents, 2);
    assert.equal(
      decideCrawlContinuation({
        budget: {
          profile: "quick",
          targetAcceptedEvents: 50,
          maxRawRecords: 300,
          maxSources: 4,
          maxPagesPerSource: 3,
          maxRequestsPerSource: 10,
          maxDetailPagesPerSource: 5,
          maxDurationMs: 45_000,
          dateHorizonStart: twoWeeks.dateHorizonStart,
          dateHorizonEnd: twoWeeks.dateHorizonEnd,
          prioritizeLatency: true,
          prioritizeCoverage: false,
        },
        coverage,
        acceptedEvents: 50,
        pagesCompleted: 1,
        stableIdentityGrowth: 1,
        repeatedFingerprint: false,
        expiredOrIrrelevantStreak: 0,
        sourceHasMorePages: true,
        elapsedMs: 10,
      }).stopReason,
      "target_and_horizon_satisfied",
    );
  });

  it("schedules high-yield sources first for light crawls and tracks source count separately", () => {
    const plan = buildCrawlPlan({ query: "find 50 hackathons fast" });
    const slow = source("https://slow.example/events", 500);
    const fast = source("https://fast.example/events", 50);
    const scheduled = scheduleAdaptiveSources({
      sources: [slow, fast],
      plan,
      yieldHistory: [
        { sourceUrl: slow.inputUrl, validEventsPerSecond: 0.5, validEventsPerPage: 5, duplicateRate: 0.2, expiredEventRate: 0.4, browserCost: 1, failureRate: 0.2, uniqueContribution: 0.3, dateCoverage: 0.3 },
        { sourceUrl: fast.inputUrl, validEventsPerSecond: 5, validEventsPerPage: 30, duplicateRate: 0.02, expiredEventRate: 0.05, browserCost: 0, failureRate: 0, uniqueContribution: 0.9, dateCoverage: 0.8 },
      ],
    });
    assert.equal(scheduled[0]?.inputUrl, fast.inputUrl);
    assert.ok(scheduled.length <= plan.maxSources);
  });

  it("emits progressive batches, dedupes globally, and records time-to-target metrics", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const host = new URL(String(input)).hostname;
      return new Response(htmlFor(host.includes("one") ? "One" : "Two", 30), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };
    const emitted: number[] = [];
    try {
      const result = await runAdaptiveCrawl({
        intent: { query: "find 50 hackathons fast" },
        sources: [source("https://one.example/events"), source("https://two.example/events")],
        onBatch: (batch) => {
          emitted.push(batch.validEvents);
        },
      });
      assert.equal(result.plan.profile, "light");
      assert.equal(result.persistenceDisabled, true);
      assert.ok(result.validEvents >= 50);
      assert.equal(result.batches.length, 2);
      assert.deepEqual(emitted, [30, 30]);
      assert.ok(result.timeToFirst10Ms !== undefined);
      assert.ok(result.timeToFirst50Ms !== undefined);
      assert.ok(result.timeToTargetMs !== undefined);
      assert.equal(result.sourceResults.length, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("supports deep checkpoint/resume idempotency through the adaptive orchestrator", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase53-checkpoint-"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(htmlFor("Checkpoint", 30), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    try {
      const input = {
        intent: { query: "deep crawl 500+ hackathons" },
        sources: [source("https://checkpoint.example/events", 30)],
        checkpointDir: root,
      };
      const first = await runAdaptiveCrawl(input);
      const second = await runAdaptiveCrawl(input);
      assert.equal(first.sourceResults[0]?.result?.acquisition.checkpointSaved, true);
      assert.equal(second.sourceResults[0]?.result?.acquisition.checkpointLoaded, true);
      assert.equal(second.validEvents, first.validEvents);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses composite identity when URL and structured ID are absent", () => {
    const composite = identityForLead(lead({ title: "No URL Hack", startDate: "2026-08-01", location: "Online" }));
    assert.equal(composite?.method, "composite");
    assert.ok((composite?.confidence ?? 0) < 0.8);
    const deduped = dedupeLeadsByIdentity([
      lead({ title: "No URL Hack", startDate: "2026-08-01", location: "Online" }),
      lead({ title: "No URL Hack", startDate: "2026-08-01", location: "Online" }),
    ]);
    assert.equal(deduped.leads.length, 1);
    assert.equal(deduped.duplicatesRemoved, 1);
  });

  it("observes iframe, shadow DOM, accessibility, virtualized, modal, and action signals", () => {
    const result = understandPageArtifacts([
      artifact(`
        <main>
          <iframe src="/embedded-events"></iframe>
          <template shadowrootmode="open"><article>Shadow Hackathon Jan 1 2027</article></template>
          <div role="list" aria-rowcount="200" data-virtualized="true">
            <article role="article"><a href="/a">Visible Hackathon</a><time>Jan 1 2027</time></article>
            <article role="article"><a href="/b">Visible Challenge</a><time>Feb 1 2027</time></article>
          </div>
          <div role="dialog" aria-modal="true">Details modal</div>
          <button>Load more events</button>
        </main>
      `),
    ]);
    assert.ok(result.observations.iframeDocuments >= 1);
    assert.ok(result.observations.shadowRoots >= 1);
    assert.ok(result.observations.accessibilityNodes >= 3);
    assert.ok(result.observations.virtualizedGrowthSignals >= 1);
    assert.ok(result.observations.modalSignals >= 1);
    assert.ok(result.actionCandidates.some((action) => action.proposedEffect === "load_more"));
  });

  it("gates AI and vision only for unresolved page shapes", () => {
    const unresolved = shouldInvokeAiOrVision({
      understanding: understandPageArtifacts([artifact("<main><div>Hackathon registration deadline Jan 1 2027</div></main>")]),
      deterministicHealthy: false,
      visibleCardText: "Hackathon registration deadline Jan 1 2027",
    });
    assert.equal(unresolved.ai, true);
    assert.equal(unresolved.vision, true);
    const healthy = shouldInvokeAiOrVision({
      understanding: understandPageArtifacts([artifact("<article><a href='/a'>Hackathon A</a><time>Jan 1 2027</time></article><article><a href='/b'>Hackathon B</a><time>Feb 1 2027</time></article>")]),
      deterministicHealthy: true,
    });
    assert.equal(healthy.ai, false);
    assert.equal(healthy.vision, false);
  });

  it("keeps Phase 5.3 experiment code generic and persistence-free", async () => {
    for (const file of [
      "src/experiments/scraper-v2/generic/adaptiveCrawler.ts",
      "src/experiments/scraper-v2/generic/pageUnderstanding.ts",
      "src/experiments/scraper-v2/generic/adaptiveProfiles.ts",
      "src/experiments/scraper-v2/generic/adaptiveIdentity.ts",
    ]) {
      const content = await readFile(file, "utf8");
      assert.doesNotMatch(content, /devpost|devfolio|mlh|dorahacks|garage48|eventbrite|taikai|unstop|hackathonradar|eventornado/i);
      assert.doesNotMatch(content, /supabase|candidateRepository|persistCandidate|googleapis|source health/i);
    }
  });
});
