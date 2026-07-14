import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { shouldCaptureNetworkResponse } from "@/experiments/scraper-v2/generic/acquisition";
import { inferGenericEventSchema } from "@/experiments/scraper-v2/generic/fieldInference";
import { normalizeGenericRecords } from "@/experiments/scraper-v2/generic/normalization";
import { inferGenericPagination } from "@/experiments/scraper-v2/generic/pagination";
import { evaluateGenericExtractionQuality } from "@/experiments/scraper-v2/generic/quality";
import { discoverGenericRecordSets } from "@/experiments/scraper-v2/generic/recordDiscovery";
import { runGenericStructuredExtraction } from "@/experiments/scraper-v2/generic/structuredExtraction";
import type {
  AcquiredArtifact,
  CandidateRecordSet,
  SourceExperiment,
} from "@/experiments/scraper-v2/generic/types";

const experiment: SourceExperiment = {
  inputUrl: "https://events.example/hackathons",
  allowedOrigins: ["https://events.example"],
  maxRequests: 20,
  maxPages: 3,
  maxPayloadBytes: 500_000,
  browserAllowed: false,
  expectedContentCategory: "public_event_directory",
  expectedMinimumEventCount: 2,
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

const eventRecords = [
  {
    uid: "alpha",
    display: "Builder Weekend",
    route: "/builder-weekend",
    launches_on: "2026-08-10T00:00:00Z",
    closes_on: "2026-08-12T00:00:00Z",
    place: { city: "Toronto", country: "Canada" },
    access: "hybrid",
    phase: "accepting registrations",
    blurb: "A weekend hackathon for useful software.",
  },
  {
    uid: "beta",
    display: "Climate Challenge",
    route: "/climate-challenge",
    launches_on: 1786320000,
    closes_on: 1786492800,
    place: { city: "Online", country: "" },
    access: "virtual",
    phase: "upcoming",
    blurb: "Build climate tools with public datasets.",
  },
  {
    uid: "gamma",
    display: "Past Demo Jam",
    route: "/past-demo-jam",
    launches_on: "2024-01-01",
    closes_on: "2024-01-03",
    phase: "completed",
  },
  {
    uid: "delta",
    display: "Health AI Hack",
    route: "/health-ai-hack",
    launches_on: "2026-10-01",
    closes_on: "2026-10-03",
    place: "Montreal, Canada",
    access: "in-person",
    phase: "open",
  },
  {
    uid: "epsilon",
    display: "Security Bounty Sprint",
    route: "/security-bounty-sprint",
    launches_on: "2026-11-01",
    closes_on: "2026-11-02",
    place: "Online",
    access: "remote",
    phase: "open",
  },
];

function selectedRecordSet(): CandidateRecordSet {
  const [set] = discoverGenericRecordSets([artifact({ page: { data: { collection: eventRecords } } })]).recordSets;
  assert.ok(set);
  return set;
}

describe("generic structured extraction", () => {
  it("discovers repeated event object arrays above config arrays", () => {
    const result = discoverGenericRecordSets([
      artifact({
        config: [{ key: "theme" }, { key: "locale" }, { key: "flags" }],
        page: { data: { collection: eventRecords } },
      }),
    ]);

    assert.ok(result.arraysScanned >= 2);
    assert.equal(result.recordSets[0]?.path, "page.data.collection");
    assert.ok((result.recordSets[0]?.eventScore ?? 0) >= 0.4);
  });

  it("penalizes navigation, sponsor, and filter arrays", () => {
    const result = discoverGenericRecordSets([
      artifact({
        navigation: [{ label: "Open" }, { label: "Past" }, { label: "Organize" }],
        sponsors: [{ logo: "/a.png", alt: "A" }, { logo: "/b.png", alt: "B" }],
        filters: [{ tag: "AI" }, { tag: "Web3" }, { tag: "Beginner" }],
      }),
    ]);

    assert.equal(result.recordSets.length, 0);
  });

  it("bounds malformed or deeply nested data", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: { records: eventRecords } } } } } } } } } };
    const result = discoverGenericRecordSets([artifact(deep)]);
    assert.equal(result.recordSets.length, 0);
  });

  it("infers title, URL, dates, nested location, status, and identity without exact aliases", () => {
    const set = selectedRecordSet();
    const schema = inferGenericEventSchema(set);

    assert.equal(schema.rejected, false);
    assert.equal(schema.title.path, "display");
    assert.equal(schema.url?.path, "route");
    assert.equal(schema.startDate?.path, "launches_on");
    assert.equal(schema.endDate?.path, "closes_on");
    assert.ok(schema.location?.path === "place" || schema.location?.path === "place.city");
    assert.equal(schema.status?.path, "phase");
    assert.equal(schema.sourceRecordId?.path, "uid");
  });

  it("rejects schema when title confidence is low", () => {
    const set = {
      ...selectedRecordSet(),
      records: [
        { id: "1", state: "open", href: "/one" },
        { id: "2", state: "open", href: "/two" },
        { id: "3", state: "open", href: "/three" },
        { id: "4", state: "open", href: "/four" },
        { id: "5", state: "open", href: "/five" },
      ],
    };
    assert.equal(inferGenericEventSchema(set).rejected, true);
  });

  it("normalizes open/upcoming records and excludes past or completed records", () => {
    const set = selectedRecordSet();
    const schema = inferGenericEventSchema(set);
    const leads = normalizeGenericRecords(set, schema, experiment);

    assert.deepEqual(leads.map((lead) => lead.title), [
      "Builder Weekend",
      "Climate Challenge",
      "Health AI Hack",
      "Security Bounty Sprint",
    ]);
    assert.ok(leads.every((lead) => lead.canonicalUrl?.startsWith("https://events.example/")));
  });

  it("does not invent slug-only URLs without evidence", () => {
    const set = {
      ...selectedRecordSet(),
      records: [{ uid: "one", display: "No Route Hack", phase: "open", launches_on: "2026-10-01" }],
    };
    const schema = inferGenericEventSchema(set);
    const leads = normalizeGenericRecords(set, schema, experiment);

    assert.equal(leads[0]?.canonicalUrl, undefined);
  });

  it("infers page number, cursor, next-link, and offset pagination signals", () => {
    const base = selectedRecordSet();
    assert.equal(inferGenericPagination({ ...base, records: [{ pageInfo: { currentPage: 1, totalPages: 3 } }] }).method, "page_number");
    assert.equal(inferGenericPagination({ ...base, records: [{ pageInfo: { endCursor: "abc", hasNextPage: true } }] }).method, "cursor");
    assert.equal(inferGenericPagination({ ...base, records: [{ links: { next: "/page/2" } }] }).method, "next_link");
    assert.equal(inferGenericPagination({ ...base, records: [{ paging: { offset: 25, limit: 25 } }] }).method, "offset");
  });

  it("calculates quality metrics and classifications", () => {
    const set = selectedRecordSet();
    const schema = inferGenericEventSchema(set);
    const leads = normalizeGenericRecords(set, schema, experiment);
    const quality = evaluateGenericExtractionQuality({
      discoveredRecords: set.records.length,
      leads,
      experiment,
    });

    assert.equal(quality.validEventLeads, 4);
    assert.equal(quality.obviousNonEvents, 0);
    assert.ok(quality.titleCompleteness > 0.9);
    assert.ok(quality.urlCompleteness > 0.9);
    assert.ok(["healthy", "usable"].includes(quality.classification));
  });

  it("rejects private/auth and mutation network responses", () => {
    const response = (method: string, url = "https://events.example/api/list") => ({
      url: () => url,
      status: () => 200,
      headers: () => ({ "content-type": "application/json" }),
      request: () => ({ method: () => method, resourceType: () => "fetch" }),
    });

    assert.equal(shouldCaptureNetworkResponse(response("GET"), experiment.allowedOrigins), true);
    assert.equal(shouldCaptureNetworkResponse(response("POST"), experiment.allowedOrigins), false);
    assert.equal(shouldCaptureNetworkResponse(response("GET", "https://private.example/api"), experiment.allowedOrigins), false);
  });

  it("runs end-to-end with mocked static acquisition and persists nothing", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        `<!doctype html><html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
          props: { pageProps: { records: eventRecords } },
        })}</script></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    try {
      const result = await runGenericStructuredExtraction(experiment);
      assert.equal(result.persistenceDisabled, true);
      assert.equal(result.quality.validEventLeads, 4);
      assert.equal(result.selectedRecordSet?.path, "props.pageProps.records");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("experiment modules do not import persistence, Queue mutation, or source health writes", async () => {
    const files = [
      "src/experiments/scraper-v2/generic/acquisition.ts",
      "src/experiments/scraper-v2/generic/structuredExtraction.ts",
      "src/experiments/structuredExtractionExperiment.ts",
    ];
    const contents = await Promise.all(files.map((file) => readFile(file, "utf8")));

    for (const content of contents) {
      assert.doesNotMatch(content, /from\s+["']@\/discovery\/persistence/);
      assert.doesNotMatch(content, /from\s+["']@\/server\/customSources\/repository/);
      assert.doesNotMatch(content, /upsertCandidate|updateCustomSourceHealth|claimJob|completeJob|failJob/i);
    }
  });

  it("generic extraction logic contains no named test-site conditions, selectors, or paths", async () => {
    const files = [
      "src/experiments/scraper-v2/generic/acquisition.ts",
      "src/experiments/scraper-v2/generic/recordDiscovery.ts",
      "src/experiments/scraper-v2/generic/fieldInference.ts",
      "src/experiments/scraper-v2/generic/normalization.ts",
      "src/experiments/scraper-v2/generic/pagination.ts",
      "src/experiments/scraper-v2/generic/quality.ts",
      "src/experiments/scraper-v2/generic/structuredExtraction.ts",
    ];
    const content = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");

    assert.doesNotMatch(content, /devfolio|dorahacks|hackathons\.space/i);
    assert.doesNotMatch(content, /open_hackathons|hackathon\/list|props\.pageProps\.dehydratedState\.queries/i);
    assert.doesNotMatch(content, /parseDevfolio|parseDoraHacks|parseHackathonsSpace/i);
  });
});
