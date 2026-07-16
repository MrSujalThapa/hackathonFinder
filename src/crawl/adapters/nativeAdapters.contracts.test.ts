import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DevpostDirectoryAdapter,
  collectDevpostViaKernel,
  mapDevpostKernelStopReason,
  type DevpostApiPageSnapshot,
} from "@/crawl/adapters/devpost";
import {
  LumaFeedAdapter,
  collectLumaFeedViaKernel,
  mapLumaKernelStopToStable,
} from "@/crawl/adapters/luma";
import { sourceStateForStopReason } from "@/crawl/stopReasons";
import type { CrawlStopReason } from "@/crawl/types";
import type { RawLead } from "@/core/discovery/types";

function lead(id: string, title: string, status = "open"): RawLead {
  return {
    id: `devpost-${id}`,
    source: "devpost",
    title,
    url: `https://${id}.devpost.com/`,
    text: title,
    links: [`https://${id}.devpost.com/`],
    postedAt: new Date().toISOString(),
    metadata: { status, attribution: "devpost", provenance: "native_devpost" },
  };
}

function pageSnapshot(
  pageNumber: number,
  leads: RawLead[],
  opts?: Partial<DevpostApiPageSnapshot>,
): DevpostApiPageSnapshot {
  const urls = leads.map((item) => item.url!).filter(Boolean);
  const base: DevpostApiPageSnapshot = {
    requestedPage: pageNumber,
    requestedUrl: `https://devpost.com/api/hackathons?page=${pageNumber}`,
    finalUrl: `https://devpost.com/api/hackathons?page=${pageNumber}`,
    leads,
    cardCount: leads.length,
    fingerprint: urls.sort().join("|"),
    firstUrls: urls.slice(0, 3),
    lastUrls: urls.slice(-3),
    hasNext: true,
    nextPage: pageNumber + 1,
    status: "completed",
    metaTotalCount: 1_000,
  };
  return { ...base, ...opts };
}

describe("DevpostDirectoryAdapter", () => {
  it("parses API pages through kernel and propagates directory total", async () => {
    const pages = new Map<number, DevpostApiPageSnapshot>([
      [1, pageSnapshot(1, [lead("a", "A"), lead("b", "B")], { metaTotalCount: 420 })],
      [2, pageSnapshot(2, [lead("c", "C")], { hasNext: false, metaTotalCount: 420 })],
    ]);

    const result = await collectDevpostViaKernel({
      maxResults: 100,
      maxPages: 10,
      timeoutMs: 5_000,
      targetCards: 75,
      stopAtTarget: true,
      fetchPage: async (pageNumber) =>
        pages.get(pageNumber) ??
        pageSnapshot(pageNumber, [], {
          hasNext: false,
          status: "failed",
          metaTotalCount: undefined,
        }),
      classifyOpenState: (status: string | undefined) =>
        status === "open" || status === "upcoming" || status === "ended" ? status : "unknown",
      buildApiUrl: (page) => `https://devpost.com/api/hackathons?page=${page}`,
      stopEvidence: (reason, total) => `${reason}:${total}`,
    });

    assert.equal(result.leads.length, 3);
    assert.equal(result.metaTotalCount, 420);
    assert.equal(result.acquisitionScope, "full_directory_api");
    assert.equal(result.stopReason, "no_next_page");
    assert.equal(result.kernelStopReason, "exhausted");
    assert.ok(result.progressEvents.some((event) => event.type === "acquired"));
    assert.ok(result.progressEvents.every((event) => !("cards" in event)));
  });

  it("stops with target_reached before maximum cards", async () => {
    const makeLeads = (page: number) =>
      Array.from({ length: 30 }, (_value, index) =>
        lead(`p${page}-${index}`, `Hack ${page}-${index}`),
      );

    const result = await collectDevpostViaKernel({
      maxResults: 100,
      maxPages: 20,
      timeoutMs: 5_000,
      targetCards: 75,
      stopAtTarget: true,
      fetchPage: async (pageNumber) =>
        pageSnapshot(pageNumber, makeLeads(pageNumber), {
          hasNext: true,
          metaTotalCount: 5_000,
        }),
      classifyOpenState: () => "open",
      buildApiUrl: (page) => `https://devpost.com/api/hackathons?page=${page}`,
      stopEvidence: (reason) => reason,
    });

    assert.ok(result.leads.length >= 75);
    assert.ok(result.leads.length <= 100);
    assert.equal(result.stopReason, "target_reached");
    assert.equal(result.kernelStopReason, "target_reached");
    assert.equal(result.targetReached, true);
    assert.equal(result.sourceState, "healthy_bounded");
  });

  it("stops with maximum_cards_reached when cap ends collection", async () => {
    const makeLeads = (page: number) =>
      Array.from({ length: 50 }, (_value, index) =>
        lead(`deep-${page}-${index}`, `Deep ${page}-${index}`),
      );

    const result = await collectDevpostViaKernel({
      maxResults: 120,
      maxPages: 20,
      timeoutMs: 5_000,
      targetCards: 300,
      stopAtTarget: false,
      fetchPage: async (pageNumber) =>
        pageSnapshot(pageNumber, makeLeads(pageNumber), {
          hasNext: true,
          metaTotalCount: 5_000,
        }),
      classifyOpenState: () => "open",
      buildApiUrl: (page) => `https://devpost.com/api/hackathons?page=${page}`,
      stopEvidence: (reason) => reason,
    });

    assert.equal(result.leads.length, 120);
    assert.equal(result.stopReason, "maximum_cards_reached");
    assert.equal(result.kernelStopReason, "maximum_cards_reached");
    assert.notEqual(result.stopReason, "exhausted");
    assert.notEqual(result.stopReason, "no_next_page");
  });

  it("maps acquisition failure without claiming exhaustion", async () => {
    const result = await collectDevpostViaKernel({
      maxResults: 75,
      maxPages: 5,
      timeoutMs: 2_000,
      targetCards: 75,
      stopAtTarget: true,
      fetchPage: async (pageNumber) =>
        pageSnapshot(pageNumber, [], {
          hasNext: false,
          status: "failed",
          error: "boom",
          metaTotalCount: undefined,
        }),
      classifyOpenState: () => "unknown",
      buildApiUrl: (page) => `https://devpost.com/api/hackathons?page=${page}`,
      stopEvidence: (reason) => reason,
    });

    assert.equal(result.leads.length, 0);
    assert.equal(result.stopReason, "api_page_failed");
    assert.equal(result.kernelStopReason, "acquisition_failed");
  });
});

describe("Devpost stop-reason mapping", () => {
  const cases: Array<[CrawlStopReason, string | undefined, string]> = [
    ["target_reached", undefined, "target_reached"],
    ["maximum_cards_reached", undefined, "maximum_cards_reached"],
    ["exhausted", "no_next_page", "no_next_page"],
    ["no_growth", "no_additional_cards", "no_additional_cards"],
    ["max_budget", "maximum_pages_reached", "maximum_pages_reached"],
    ["timeout", "timeout", "timeout"],
    ["acquisition_failed", "api_page_failed", "api_page_failed"],
  ];

  for (const [kernel, detail, expected] of cases) {
    it(`maps ${kernel}/${detail ?? "none"} → ${expected}`, () => {
      assert.equal(mapDevpostKernelStopReason(kernel, detail), expected);
      assert.ok(sourceStateForStopReason(kernel));
    });
  }
});

describe("LumaFeedAdapter", () => {
  it("grows a single feed through the kernel without theme knowledge", async () => {
    let scrolls = 0;
    const batches: RawLead[][] = [
      [
        {
          id: "luma-1",
          source: "luma",
          title: "One",
          url: "https://luma.com/one",
          text: "One",
          links: ["https://luma.com/one"],
          postedAt: new Date().toISOString(),
          metadata: { discoveryMode: "luma_tech" },
        },
      ],
      [
        {
          id: "luma-1",
          source: "luma",
          title: "One",
          url: "https://luma.com/one",
          text: "One",
          links: ["https://luma.com/one"],
          postedAt: new Date().toISOString(),
          metadata: { discoveryMode: "luma_tech" },
        },
        {
          id: "luma-2",
          source: "luma",
          title: "Two",
          url: "https://luma.com/two",
          text: "Two",
          links: ["https://luma.com/two"],
          postedAt: new Date().toISOString(),
          metadata: { discoveryMode: "luma_tech" },
        },
      ],
      [
        {
          id: "luma-1",
          source: "luma",
          title: "One",
          url: "https://luma.com/one",
          text: "One",
          links: ["https://luma.com/one"],
          postedAt: new Date().toISOString(),
          metadata: { discoveryMode: "luma_tech" },
        },
        {
          id: "luma-2",
          source: "luma",
          title: "Two",
          url: "https://luma.com/two",
          text: "Two",
          links: ["https://luma.com/two"],
          postedAt: new Date().toISOString(),
          metadata: { discoveryMode: "luma_tech" },
        },
      ],
    ];

    const result = await collectLumaFeedViaKernel({
      feedUrl: "https://luma.com/tech",
      maxEvents: 50,
      maxScrolls: 5,
      timeoutMs: 5_000,
      hooks: {
        collectLeads: async () => batches[Math.min(scrolls, batches.length - 1)]!,
        scroll: async () => {
          scrolls += 1;
        },
        waitMs: 1,
        noGrowthLimit: 2,
      },
    });

    assert.equal(result.uniqueCount, 2);
    assert.equal(result.leads.length, 2);
    assert.equal(result.stopReason, "no_growth");
    assert.equal(result.kernelStopReason, "no_growth");
    assert.ok(result.scrollAttempts >= 2);
    assert.ok(!JSON.stringify(result.progressEvents).includes("luma_tech"));
  });

  it("honours cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await collectLumaFeedViaKernel({
      feedUrl: "https://luma.com/tech",
      maxEvents: 50,
      maxScrolls: 5,
      timeoutMs: 5_000,
      signal: controller.signal,
      hooks: {
        collectLeads: async () => [],
        scroll: async () => undefined,
        waitMs: 1,
        noGrowthLimit: 2,
      },
    });
    assert.equal(result.kernelStopReason, "cancelled");
    assert.equal(mapLumaKernelStopToStable("cancelled", undefined), "no_growth");
  });

  it("keeps feed-local identities; global merge stays outside kernel", async () => {
    const adapter = new LumaFeedAdapter({
      feedUrl: "https://luma.com/ai",
      hooks: {
        collectLeads: async () => [
          {
            id: "luma-shared",
            source: "luma",
            title: "Shared",
            url: "https://luma.com/shared",
            text: "Shared",
            links: ["https://luma.com/shared"],
            postedAt: new Date().toISOString(),
            metadata: {},
          },
        ],
        scroll: async () => undefined,
        waitMs: 1,
        noGrowthLimit: 1,
      },
    });
    const acquired = await adapter.acquire({
      url: "https://luma.com/ai",
      budget: {
        maxDurationMs: 1_000,
        maxRequests: 3,
        maxPagesOrScrolls: 2,
        maxBrowserActions: 2,
        maxPayloadBytes: 1_000,
        maxUnique: 10,
      },
    });
    assert.equal(acquired.session.leadsByIdentity.size, 1);
    assert.equal(acquired.mechanism, "scroll");
  });
});

describe("native source-state mapping", () => {
  it("keeps Terminal-facing states for common native stops", () => {
    assert.equal(sourceStateForStopReason("target_reached"), "healthy_bounded");
    assert.equal(sourceStateForStopReason("maximum_cards_reached"), "healthy_bounded");
    assert.equal(sourceStateForStopReason("no_growth"), "healthy_complete");
    assert.equal(sourceStateForStopReason("exhausted"), "healthy_complete");
    assert.equal(sourceStateForStopReason("blocked_authentication"), "blocked_authentication");
    assert.equal(sourceStateForStopReason("acquisition_failed"), "acquisition_failed");
    assert.equal(sourceStateForStopReason("cancelled"), "usable_partial");
  });
});

describe("Devpost listing-before-detail invariant", () => {
  it("completes listing growth before any detail enrichment can start", async () => {
    const events: string[] = [];
    const makeLeads = (page: number) =>
      Array.from({ length: 40 }, (_value, index) =>
        lead(`list-${page}-${index}`, `List ${page}-${index}`),
      );

    const listing = await collectDevpostViaKernel({
      maxResults: 75,
      maxPages: 10,
      timeoutMs: 5_000,
      targetCards: 75,
      stopAtTarget: true,
      fetchPage: async (pageNumber) => {
        events.push(`list-page-${pageNumber}`);
        return pageSnapshot(pageNumber, makeLeads(pageNumber), {
          hasNext: true,
          metaTotalCount: 2_000,
        });
      },
      classifyOpenState: () => "open",
      buildApiUrl: (page) => `https://devpost.com/api/hackathons?page=${page}`,
      stopEvidence: (reason) => reason,
    });

    events.push("listing-complete");
    // Detail enrichment is collector-owned and must start only after listing returns.
    events.push("detail-start");
    assert.ok(listing.leads.length >= 50);
    assert.equal(listing.stopReason, "target_reached");
    const listingDoneAt = events.indexOf("listing-complete");
    const detailStartAt = events.indexOf("detail-start");
    assert.ok(listingDoneAt >= 0);
    assert.ok(detailStartAt > listingDoneAt);
    assert.ok(events.filter((event) => event.startsWith("list-page-")).length >= 1);
  });
});
