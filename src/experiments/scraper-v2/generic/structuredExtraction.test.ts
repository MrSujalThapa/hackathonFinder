import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { shouldCaptureNetworkResponse } from "@/experiments/scraper-v2/generic/acquisition";
import { buildDomRepresentations } from "@/experiments/scraper-v2/generic/domRepresentation";
import { detectRepeatedDomUnitSets } from "@/experiments/scraper-v2/generic/domRepeatedUnits";
import { inferDomSchemaAndLeads } from "@/experiments/scraper-v2/generic/domSchema";
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

function htmlArtifact(html: string): AcquiredArtifact {
  return {
    artifactId: "html:fixture",
    kind: "html",
    sourceUrl: experiment.inputUrl,
    payload: { title: "Fixture", bodyTextLength: html.length, html },
    byteSize: html.length,
    acquisitionMode: "static",
    timingMs: 1,
  };
}

const repeatedCardsHtml = `
  <main>
    <section>
      <article class="event-card"><a href="/alpha-hack"><h2>Alpha Hack</h2></a><p>Aug 10, 2026</p><p>Toronto, Canada</p></article>
      <article class="event-card"><a href="/beta-build"><h2>Beta Build</h2></a><p>Sep 11, 2026</p><p>Online</p></article>
      <article class="event-card"><a href="/gamma-jam"><h2>Gamma Jam</h2></a><p>Oct 12, 2026</p><p>Hybrid</p></article>
    </section>
  </main>`;

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

  it("rejects repeated schema type labels as titles", () => {
    const [set] = discoverGenericRecordSets([
      artifact({
        itemListElement: [
          { "@type": "ListItem", position: 1, url: "https://events.example/one" },
          { "@type": "ListItem", position: 2, url: "https://events.example/two" },
          { "@type": "ListItem", position: 3, url: "https://events.example/three" },
          { "@type": "ListItem", position: 4, url: "https://events.example/four" },
          { "@type": "ListItem", position: 5, url: "https://events.example/five" },
        ],
      }),
    ]).recordSets;
    assert.ok(set);
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
    assert.ok(["healthy_complete", "healthy_bounded", "usable_partial"].includes(quality.classification));
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

  it("detects repeated sibling DOM event cards and generates a declarative schema", () => {
    const [representation] = buildDomRepresentations([htmlArtifact(repeatedCardsHtml)]);
    assert.ok(representation);
    const unitSets = detectRepeatedDomUnitSets([representation]);
    const selected = unitSets[0];
    assert.ok(selected);
    assert.equal(selected.diagnostics.unitCount, 3);
    assert.ok(selected.confidence >= 0.5);

    const inferred = inferDomSchemaAndLeads({ representation, unitSet: selected, experiment });
    assert.ok(inferred.schema);
    assert.equal(inferred.schema.version, 1);
    assert.equal(inferred.leads.length, 3);
    assert.deepEqual(inferred.leads.map((lead) => lead.title), ["Alpha Hack", "Beta Build", "Gamma Jam"]);
  });

  it("prefers nested repeated records over a whole section wrapper", () => {
    const nested = `<main><section class="open-list">${repeatedCardsHtml}${repeatedCardsHtml}</section></main>`;
    const [representation] = buildDomRepresentations([htmlArtifact(nested)]);
    assert.ok(representation);
    const [selected] = detectRepeatedDomUnitSets([representation]);
    assert.ok(selected);
    const unit = representation.nodes.find((node) => node.nodeId === selected.unitNodeIds[0]);
    assert.equal(unit?.tag, "article");
  });

  it("rejects navigation, footer, sponsor, and status-tab DOM groups", () => {
    const html = `
      <nav><a href="/open">Open</a><a href="/past">Past</a><a href="/organize">Organize</a></nav>
      <footer><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer>
      <section class="sponsors"><div><img alt="A" /></div><div><img alt="B" /></div></section>
      <div class="tabs"><button>Open</button><button>Past</button><button>Upcoming</button></div>`;
    const [representation] = buildDomRepresentations([htmlArtifact(html)]);
    assert.ok(representation);
    assert.equal(detectRepeatedDomUnitSets([representation]).length, 0);
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
      assert.equal(result.strategySelected, "structured");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("selects DOM extraction when structured artifacts fail but repeated cards validate", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(`<!doctype html><html><body>${repeatedCardsHtml}</body></html>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    try {
      const result = await runGenericStructuredExtraction(experiment);
      assert.equal(result.persistenceDisabled, true);
      assert.equal(result.strategySelected, "dom");
      assert.equal(result.quality.validEventLeads, 3);
      assert.ok(result.dom?.schema);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("prefers higher-precision DOM extraction over larger noisy structured records", async () => {
    const noisyStructuredRecords = [
      {
        id: "home",
        title: "Home",
        href: "/home",
        starts_at: "2026-08-01",
        location: "Online",
        status: "open",
        kind: "hackathon event",
      },
      {
        id: "about",
        title: "About",
        href: "/about",
        starts_at: "2026-08-02",
        location: "Online",
        status: "open",
        kind: "hackathon event",
      },
      {
        id: "sponsor",
        title: "Sponsor",
        href: "/sponsor",
        starts_at: "2026-08-03",
        location: "Online",
        status: "open",
        kind: "hackathon event",
      },
      {
        id: "faq",
        title: "FAQ",
        href: "/faq",
        starts_at: "2026-08-04",
        location: "Online",
        status: "open",
        kind: "hackathon event",
      },
      {
        id: "menu",
        title: "Menu",
        href: "/menu",
        starts_at: "2026-08-05",
        location: "Online",
        status: "open",
        kind: "hackathon event",
      },
    ];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        `<!doctype html><html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
          props: { pageProps: { records: noisyStructuredRecords } },
        })}</script><body>${repeatedCardsHtml}</body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    try {
      const result = await runGenericStructuredExtraction(experiment);
      assert.equal(result.persistenceDisabled, true);
      assert.equal(result.strategySelected, "dom");
      assert.deepEqual(result.leads.map((lead) => lead.title), ["Alpha Hack", "Beta Build", "Gamma Jam"]);
      assert.equal(result.quality.obviousNonEvents, 0);
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
