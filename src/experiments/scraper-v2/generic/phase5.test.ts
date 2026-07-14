import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { adapterCacheId, LocalAdapterCache, validateCachedAdapter } from "@/experiments/scraper-v2/generic/adapterCache";
import { validateAiDecisionProposal, decideAiInvocation, buildSanitizedAiDecisionInput } from "@/experiments/scraper-v2/generic/aiPlanning";
import { enumerateCandidateActionsFromHtml, verifyActionResult } from "@/experiments/scraper-v2/generic/browserActions";
import { inferDiscoveryBudget, parseCrawlIntent } from "@/experiments/scraper-v2/generic/budget";
import { checkpointId, LocalCheckpointStore } from "@/experiments/scraper-v2/generic/checkpoints";
import { summarizeDateCoverage, decideCrawlContinuation } from "@/experiments/scraper-v2/generic/dateCoverage";
import { validateEventIntent } from "@/experiments/scraper-v2/generic/eventIntentValidation";
import { inferGenericEventSchema } from "@/experiments/scraper-v2/generic/fieldInference";
import { evaluateGenericExtractionQuality } from "@/experiments/scraper-v2/generic/quality";
import { boundedMap, CircuitBreaker, HostConcurrencyLimiter, retryTransient } from "@/experiments/scraper-v2/generic/runtimeControls";
import { discoverGenericRecordSets } from "@/experiments/scraper-v2/generic/recordDiscovery";
import { runGenericStructuredExtraction } from "@/experiments/scraper-v2/generic/structuredExtraction";
import type { AcquiredArtifact, GenericShadowLead, SourceExperiment } from "@/experiments/scraper-v2/generic/types";

const experiment: SourceExperiment = {
  inputUrl: "https://events.example/hackathons",
  allowedOrigins: ["https://events.example"],
  maxRequests: 20,
  maxPages: 3,
  maxPayloadBytes: 500_000,
  browserAllowed: false,
  expectedContentCategory: "public_event_directory",
  expectedMinimumEventCount: 3,
};

function artifact(payload: unknown): AcquiredArtifact {
  return {
    artifactId: "fixture:1",
    kind: "next_data",
    sourceUrl: experiment.inputUrl,
    payload,
    byteSize: JSON.stringify(payload).length,
    acquisitionMode: "static",
    timingMs: 1,
  };
}

const goodRecords = [
  { id: "a", title: "Climate Hack", href: "/climate-hack", starts_at: "2026-08-01", location: "Online", status: "open" },
  { id: "b", title: "Health AI Challenge", href: "/health-ai", starts_at: "2026-09-01", location: "Toronto", status: "upcoming" },
  { id: "c", title: "Security Build Jam", href: "/security-build", starts_at: "2026-10-01", location: "Hybrid", status: "open" },
];

const noisyRecords = [
  { label: "Open", href: "/hackathons" },
  { label: "Past", href: "/hackathons" },
  { label: "Organize", href: "/hackathons" },
  { label: "Sponsors", href: "/sponsors" },
  { label: "FAQ", href: "/faq" },
];

function lead(title: string, startDate: string, status: GenericShadowLead["normalizedStatus"] = "open"): GenericShadowLead {
  return {
    sourceUrl: experiment.inputUrl,
    artifactKind: "next_data",
    title,
    canonicalUrl: `https://events.example/${title.toLowerCase().replace(/\s+/g, "-")}`,
    startDate,
    normalizedStatus: status,
    statusInference: "test",
    confidence: 0.9,
  };
}

describe("phase 5 adaptive generic scraping helpers", () => {
  it("infers quick, standard, deep, and exhaustive budgets from request intent", () => {
    assert.equal(inferDiscoveryBudget({ query: "quick search for 50 hackathons" }).profile, "quick");
    assert.equal(inferDiscoveryBudget({ query: "normal search for 150 events" }).profile, "standard");
    assert.equal(inferDiscoveryBudget({ query: "deep search for 500+ hackathons" }).profile, "deep");
    assert.equal(inferDiscoveryBudget({ query: "exhaustive all public hackathons" }).profile, "exhaustive");

    const intent = parseCrawlIntent({ query: "long horizon next 6 months, coverage preferred", latencyPreference: "coverage" });
    const budget = inferDiscoveryBudget(intent);
    assert.equal(budget.prioritizeCoverage, true);
    assert.ok(budget.dateHorizonEnd);
  });

  it("uses date coverage and horizon state as crawl stop conditions", () => {
    const budget = inferDiscoveryBudget({
      query: "quick hackathons next 6 months",
      dateHorizonStart: "2026-08-01T00:00:00.000Z",
      dateHorizonEnd: "2027-01-01T00:00:00.000Z",
    });
    const coverage = summarizeDateCoverage({
      leads: [
        lead("August Hack", "2026-08-01T00:00:00.000Z"),
        lead("January Hack", "2027-01-02T00:00:00.000Z"),
      ],
      rawRecords: 2,
      dateHorizonStart: budget.dateHorizonStart,
      dateHorizonEnd: budget.dateHorizonEnd,
    });

    assert.equal(coverage.horizonCovered, true);
    assert.equal(
      decideCrawlContinuation({
        budget,
        coverage,
        acceptedEvents: budget.targetAcceptedEvents,
        pagesCompleted: 1,
        stableIdentityGrowth: 2,
        repeatedFingerprint: false,
        expiredOrIrrelevantStreak: 0,
        sourceHasMorePages: true,
        elapsedMs: 100,
      }).stopReason,
      "target_and_horizon_satisfied",
    );
    assert.equal(
      decideCrawlContinuation({
        budget,
        coverage,
        acceptedEvents: 2,
        pagesCompleted: 2,
        stableIdentityGrowth: 0,
        repeatedFingerprint: false,
        expiredOrIrrelevantStreak: 0,
        sourceHasMorePages: true,
        elapsedMs: 100,
      }).stopReason,
      "no_stable_identity_growth",
    );
  });

  it("validates event intent and rejects larger noisy navigation/status sets", () => {
    const result = discoverGenericRecordSets([artifact({ good: goodRecords, noisy: noisyRecords })]);
    const good = result.recordSets.find((set) => set.path === "good");
    const noisy = result.recordSets.find((set) => set.path === "noisy");
    assert.ok(good);
    assert.ok(noisy);

    const goodValidation = validateEventIntent({ recordSet: good, schema: inferGenericEventSchema(good) });
    const noisyValidation = validateEventIntent({ recordSet: noisy, schema: inferGenericEventSchema(noisy) });
    assert.ok(["healthy", "usable"].includes(goodValidation.classification));
    assert.equal(noisyValidation.classification, "rejected");
    assert.ok(goodValidation.eventIntentScore > noisyValidation.eventIntentScore);
  });

  it("rejects form/questionnaire arrays as event record sets", () => {
    const result = discoverGenericRecordSets([
      artifact({
        questions: [
          { question: "Please introduce your team background and experience", type: "textarea" },
          { question: "Which track would you like to participate in?", options: ["AI", "Web3"] },
          { question: "What is your team size?", options: ["2", "3", "4"] },
          { question: "Do you have repositories to showcase?", type: "url" },
        ],
      }),
    ]);
    assert.equal(result.recordSets.some((set) => set.path === "questions" && set.rejectionReasons.length === 0), false);
  });

  it("does not classify bounded low-recall samples as healthy complete", () => {
    const leads = Array.from({ length: 8 }, (_value, index) =>
      lead(`Useful Hack ${index + 1}`, `2026-${String((index % 3) + 8).padStart(2, "0")}-01T00:00:00.000Z`),
    );
    const quality = evaluateGenericExtractionQuality({
      discoveredRecords: 8,
      leads,
      experiment: { ...experiment, expectedMinimumEventCount: 100 },
      estimatedAvailableRecords: 100,
    });
    assert.equal(quality.estimatedRecall, 0.08);
    assert.equal(quality.classification, "degraded_under_extraction");

    const bounded = evaluateGenericExtractionQuality({
      discoveredRecords: 50,
      leads: Array.from({ length: 50 }, (_value, index) => lead(`Cap Hack ${index}`, "2026-08-01T00:00:00.000Z")),
      experiment,
      estimatedAvailableRecords: 100,
      capReached: true,
    });
    assert.equal(bounded.classification, "healthy_bounded");
  });

  it("applies event-intent selection end-to-end and persists nothing", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        `<!doctype html><html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
          props: { pageProps: { noisy: noisyRecords, good: goodRecords } },
        })}</script></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    try {
      const result = await runGenericStructuredExtraction(experiment);
      assert.equal(result.persistenceDisabled, true);
      assert.equal(result.selectedRecordSet?.path, "props.pageProps.good");
      assert.ok(result.eventIntentValidations.length >= 1);
      assert.equal(result.quality.obviousNonEvents, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("executes generic page-param pagination and merges records across pages", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("page") ?? "1");
      const records = Array.from({ length: 3 }, (_value, index) => ({
        id: `p${page}-${index}`,
        title: `Page ${page} Hack ${index}`,
        href: `/page-${page}-hack-${index}`,
        starts_at: `2026-${String(Math.min(9, page + 7)).padStart(2, "0")}-01`,
        location: "Online",
        status: "open",
      }));
      if (page === 1) {
        return new Response(
          `<!doctype html><html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
            records,
            meta: { total_count: 9 },
          })}</script></html>`,
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }
      return new Response(JSON.stringify({ records, meta: { total_count: 9 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    try {
      const result = await runGenericStructuredExtraction({
        ...experiment,
        inputUrl: "https://events.example/list?page=1",
        maxPages: 3,
        maxRequests: 10,
      });
      assert.equal(result.acquisition.paginationExecuted, true);
      assert.equal(result.acquisition.pagesRequested, 3);
      assert.equal(result.selectedRecordSet?.records, 9);
      assert.equal(result.quality.validEventLeads, 9);
      assert.equal(result.quality.estimatedAvailableRecords, 9);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("gates AI invocation and strictly validates declarative AI proposals", () => {
    assert.equal(
      decideAiInvocation({
        blockedReason: undefined,
        attemptedPageShape: false,
        validations: [{ ...validateEventIntent({
          recordSet: discoverGenericRecordSets([artifact({ noisy: noisyRecords })]).recordSets[0]!,
        }), classification: "ambiguous" }],
      }).shouldInvoke,
      true,
    );
    assert.equal(
      decideAiInvocation({
        blockedReason: undefined,
        attemptedPageShape: false,
        validations: [{ ...validateEventIntent({
          recordSet: discoverGenericRecordSets([artifact({ good: goodRecords })]).recordSets[0]!,
        }), classification: "healthy" }],
      }).shouldInvoke,
      false,
    );

    const accepted = validateAiDecisionProposal({
      classification: "usable",
      selectedRecordSetId: "set:1",
      fieldMapping: { title: "title", url: "href", startDate: "starts_at" },
      paginationHint: { proposedEffect: "next_page", confidence: 0.7 },
      confidence: 0.75,
      reasoningSummary: "The selected records have unique titles, URLs, and dates.",
    });
    assert.equal(accepted.ok, true);
    assert.equal(validateAiDecisionProposal({ classification: "usable", confidence: 0.9, reasoningSummary: "run javascript:alert(1)" }).ok, false);

    const recordSet = discoverGenericRecordSets([artifact({ good: goodRecords })]).recordSets[0]!;
    const sanitized = buildSanitizedAiDecisionInput({
      recordSets: [{ ...recordSet, records: [{ ...goodRecords[0], cookie: "secret", authorization: "secret" }] }],
      schemas: [inferGenericEventSchema(recordSet)],
      validations: [validateEventIntent({ recordSet })],
    });
    assert.doesNotMatch(JSON.stringify(sanitized), /secret/);
  });

  it("enumerates generic browser actions and verifies action results", () => {
    const actions = enumerateCandidateActionsFromHtml(
      `<main><a href="/events?page=2" aria-label="Next page">Next</a><button>Load more events</button><a href="/about">About</a></main>`,
      experiment.inputUrl,
    );
    assert.equal(actions[0]?.proposedEffect, "next_page");
    assert.ok(actions.some((action) => action.proposedEffect === "load_more"));
    assert.equal(actions.some((action) => action.href?.endsWith("/about")), false);

    assert.equal(
      verifyActionResult({
        beforeFingerprint: "a",
        afterFingerprint: "b",
        previousIdentityCount: 3,
        nextIdentityCount: 5,
        previousEventQuality: 0.9,
        nextEventQuality: 0.88,
        dateCoverageImproved: false,
        usefulRecordsAdded: 2,
        navigatedToAllowedOrigin: true,
      }).accepted,
      true,
    );
    assert.equal(
      verifyActionResult({
        beforeFingerprint: "a",
        afterFingerprint: "a",
        previousIdentityCount: 3,
        nextIdentityCount: 3,
        previousEventQuality: 0.9,
        nextEventQuality: 0.4,
        dateCoverageImproved: false,
        usefulRecordsAdded: 0,
        navigatedToAllowedOrigin: false,
      }).accepted,
      false,
    );
  });

  it("enforces concurrency bounds, host limits, retry classification, and circuit breaking", async () => {
    let active = 0;
    let peak = 0;
    await boundedMap([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value;
    });
    assert.equal(peak, 2);

    const limiter = new HostConcurrencyLimiter(1);
    const order: string[] = [];
    await Promise.all([
      limiter.run("events.example", async () => {
        order.push("first-start");
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push("first-end");
      }),
      limiter.run("events.example", async () => {
        order.push("second-start");
      }),
    ]);
    assert.deepEqual(order, ["first-start", "first-end", "second-start"]);

    let attempts = 0;
    const value = await retryTransient({
      attempts: 2,
      baseDelayMs: 1,
      stage: "static_http",
      task: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("network socket reset");
        return "ok";
      },
    });
    assert.equal(value, "ok");

    let now = 0;
    const breaker = new CircuitBreaker(2, 100, () => now);
    breaker.recordFailure();
    breaker.recordFailure();
    assert.equal(breaker.canAttempt(), false);
    now = 101;
    assert.equal(breaker.canAttempt(), true);
  });

  it("stores resumable checkpoints with stable idempotency keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "scraper-v2-checkpoints-"));
    try {
      const store = new LocalCheckpointStore(root);
      const id = checkpointId({ sourceUrl: experiment.inputUrl, profile: "deep", dateHorizonEnd: "2027-01-01" });
      assert.equal(id, checkpointId({ sourceUrl: experiment.inputUrl, profile: "deep", dateHorizonEnd: "2027-01-01" }));
      await store.save(id, {
        sourceUrl: experiment.inputUrl,
        pageFingerprint: "page:1",
        seenIdentityHashes: ["a", "b"],
        pagesCompleted: 2,
        recordsObserved: 50,
        dateCoverage: summarizeDateCoverage({ leads: [lead("A", "2026-08-01")], rawRecords: 1 }),
        updatedAt: "2026-07-14T00:00:00.000Z",
      });
      const loaded = await store.load(id);
      assert.equal(loaded?.pagesCompleted, 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("validates and invalidates cached declarative adapters", async () => {
    const root = await mkdtemp(join(tmpdir(), "scraper-v2-adapters-"));
    try {
      const sourceUrl = experiment.inputUrl;
      assert.equal(adapterCacheId(sourceUrl), adapterCacheId(sourceUrl));
      const cache = new LocalAdapterCache(root);
      const adapter = {
        sourceUrl,
        pageFingerprint: "fingerprint:a",
        schema: {
          recordSetId: "set:1",
          title: { path: "title", confidence: 0.9, evidence: [] },
          confidence: 0.9,
          rejected: false,
          rejectionReasons: [],
        },
        validationMetrics: {
          titleCompleteness: 1,
          urlCompleteness: 0.9,
          duplicateRate: 0,
          validSampleRate: 1,
        },
        updatedAt: "2026-07-14T00:00:00.000Z",
      };
      await cache.save(adapter);
      const loaded = await cache.load(sourceUrl);
      assert.equal(loaded?.pageFingerprint, "fingerprint:a");
      assert.equal(
        validateCachedAdapter({
          cached: adapter,
          currentPageFingerprint: "fingerprint:a",
          currentMetrics: adapter.validationMetrics,
        }).valid,
        true,
      );
      assert.equal(
        validateCachedAdapter({
          cached: adapter,
          currentPageFingerprint: "fingerprint:b",
          currentMetrics: { titleCompleteness: 0.5, urlCompleteness: 0.2, duplicateRate: 0.7, validSampleRate: 0.5 },
        }).valid,
        false,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
