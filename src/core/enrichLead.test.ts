import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSafePublicHttpUrl,
  enrichPromisingLeads,
  parseEnrichedPage,
  resolveEnrichmentTarget,
  UnsafeUrlError,
} from "@/core/enrichLead";
import type { RawLead } from "@/core/discovery/types";
import { createMockSearchProvider } from "@/lib/search/providers/mock";

describe("enrichLead SSRF protections", () => {
  it("allows public http(s) URLs", () => {
    assert.equal(assertSafePublicHttpUrl("https://example.com/hack").hostname, "example.com");
  });

  it("rejects localhost and private networks", () => {
    assert.throws(() => assertSafePublicHttpUrl("http://localhost/secret"), UnsafeUrlError);
    assert.throws(() => assertSafePublicHttpUrl("http://127.0.0.1/secret"), UnsafeUrlError);
    assert.throws(() => assertSafePublicHttpUrl("http://192.168.1.10/x"), UnsafeUrlError);
    assert.throws(() => assertSafePublicHttpUrl("file:///etc/passwd"), UnsafeUrlError);
  });
});

describe("parseEnrichedPage", () => {
  it("extracts title, description, and apply link", () => {
    const html = `<!DOCTYPE html><html><head>
      <meta property="og:title" content="Toronto AI Hackathon" />
      <meta property="og:description" content="Build agents in Toronto" />
    </head><body>
      <div class="location">Toronto, Canada</div>
      <time datetime="2026-09-13">Sep 13</time>
      <a href="https://official.example.com/apply">Apply now</a>
      <p>Deadline: 2026-08-15 registration closes</p>
    </body></html>`;
    const parsed = parseEnrichedPage(html, "https://official.example.com/event");
    assert.equal(parsed.title, "Toronto AI Hackathon");
    assert.match(String(parsed.description), /agents/i);
    assert.match(String(parsed.applyUrl), /apply/i);
  });
});

describe("enrichPromisingLeads", () => {
  it("enriches selected web leads and isolates failures", async () => {
    const leads: RawLead[] = [
      {
        id: "web-1",
        source: "web",
        title: "Good",
        url: "https://good.example.com/hack",
        text: "snippet",
        links: ["https://good.example.com/hack"],
        postedAt: "2026-07-01T00:00:00Z",
        metadata: { query: "q", snippet: "snippet" },
      },
      {
        id: "web-2",
        source: "web",
        title: "Bad",
        url: "https://bad.example.com/hack",
        text: "snippet",
        links: ["https://bad.example.com/hack"],
        postedAt: "2026-07-01T00:00:00Z",
      },
      {
        id: "mlh-1",
        source: "mlh",
        title: "Skip",
        url: "https://mlh.io/events/1",
        text: "card",
        links: [],
        postedAt: "2026-07-01T00:00:00Z",
      },
    ];

    const result = await enrichPromisingLeads(leads, {
      fetchImpl: async (url) => {
        if (url.includes("bad.example.com")) throw new Error("boom");
        return `<html><head><title>Enriched Hackathon</title>
          <meta name="description" content="Full page details" /></head>
          <body><a href="/apply">Apply</a></body></html>`;
      },
      maxPages: 10,
      concurrency: 2,
      timeoutMs: 2_000,
      searchProvider: null,
    });

    assert.equal(result.enrichedCount, 1);
    assert.equal(result.leads[0]?.title, "Enriched Hackathon");
    assert.ok(result.leads[0]?.metadata?.snippet === "snippet");
    assert.equal(result.leads[1]?.title, "Bad");
    assert.ok(result.warnings.some((w) => /bad\.example\.com/i.test(w)));
    assert.equal(result.leads[2]?.title, "Skip");
  });

  it("enriches X leads via outbound official URL and preserves socialUrl", async () => {
    const postUrl = "https://x.com/hackorg/status/99";
    const official = "https://hack.utoronto.edu/ai-2026";
    const leads: RawLead[] = [
      {
        id: "x-99",
        source: "x",
        title: "UofT AI Hackathon 2026 — apply now",
        url: postUrl,
        text: `Applications open ${official}`,
        links: [postUrl, official],
        postedAt: "2026-07-01T00:00:00Z",
        metadata: {
          socialUrl: postUrl,
          officialUrl: official,
          evidenceType: "x_post",
        },
      },
    ];

    const fetched: string[] = [];
    const result = await enrichPromisingLeads(leads, {
      searchProvider: null,
      fetchImpl: async (url) => {
        fetched.push(url);
        return `<html><head><title>UofT AI Hackathon 2026</title>
          <meta name="description" content="In-person Toronto. Deadline: 2026-08-01" /></head>
          <body>
            <div class="location">Toronto, Canada</div>
            <a href="/apply">Apply</a>
            <p>Deadline: 2026-08-01 registration closes</p>
          </body></html>`;
      },
    });

    assert.equal(result.enrichedCount, 1);
    assert.deepEqual(fetched, [official]);
    assert.equal(resolveEnrichmentTarget(leads[0]!), official);

    const enriched = result.leads[0]!;
    assert.equal(enriched.metadata?.officialUrl, official);
    assert.equal(enriched.metadata?.socialUrl, postUrl);
    assert.equal(enriched.metadata?.enrichedFrom, official);
    assert.match(String(enriched.title), /UofT AI Hackathon/i);
    assert.ok(!String(enriched.metadata?.officialUrl).includes("x.com"));
  });

  it("does not invent official pages for social-only X leads without search", async () => {
    const postUrl = "https://x.com/hackleads/status/123";
    const leads: RawLead[] = [
      {
        id: "x-123",
        source: "x",
        title: "Maybe a hackathon soon?",
        url: postUrl,
        text: "Heard there might be a cool hackathon. DM for details.",
        links: [postUrl],
        postedAt: "2026-07-01T00:00:00Z",
        metadata: { socialUrl: postUrl },
      },
    ];

    let fetches = 0;
    const result = await enrichPromisingLeads(leads, {
      searchProvider: null,
      fetchImpl: async () => {
        fetches += 1;
        return "<html><body>nope</body></html>";
      },
    });

    assert.equal(fetches, 0);
    assert.equal(result.enrichedCount, 0);
    assert.equal(result.leads[0]?.metadata?.socialUrl, postUrl);
    assert.equal(result.leads[0]?.metadata?.officialUrl, undefined);
  });

  it("optionally soft-searches linkless X leads when provider is available", async () => {
    const postUrl = "https://x.com/org/status/7";
    const foundOfficial = "https://agents.example.com/hack-2026";
    const leads: RawLead[] = [
      {
        id: "x-7",
        source: "x",
        title: "Agents Hack 2026 applications open",
        url: postUrl,
        text: "Applications open for Agents Hack 2026",
        links: [postUrl],
        postedAt: "2026-07-01T00:00:00Z",
        metadata: { socialUrl: postUrl },
      },
    ];

    const result = await enrichPromisingLeads(leads, {
      searchProvider: createMockSearchProvider({
        results: [
          {
            title: "Agents Hack 2026",
            url: foundOfficial,
            snippet: "Apply now",
            source: "mock",
          },
        ],
      }),
      fetchImpl: async (url) => {
        assert.equal(url, foundOfficial);
        return `<html><head><title>Agents Hack 2026</title></head>
          <body><a href="/apply">Apply</a></body></html>`;
      },
    });

    assert.equal(result.enrichedCount, 1);
    assert.equal(result.leads[0]?.metadata?.officialUrl, foundOfficial);
    assert.equal(result.leads[0]?.metadata?.socialUrl, postUrl);
  });
});
