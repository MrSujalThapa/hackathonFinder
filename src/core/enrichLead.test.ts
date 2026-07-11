import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSafePublicHttpUrl,
  enrichPromisingLeads,
  parseEnrichedPage,
  UnsafeUrlError,
} from "@/core/enrichLead";
import type { RawLead } from "@/core/discovery/types";

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
    });

    assert.equal(result.enrichedCount, 1);
    assert.equal(result.leads[0]?.title, "Enriched Hackathon");
    assert.ok(result.leads[0]?.metadata?.snippet === "snippet");
    assert.equal(result.leads[1]?.title, "Bad");
    assert.ok(result.warnings.some((w) => /bad\.example\.com/i.test(w)));
    assert.equal(result.leads[2]?.title, "Skip");
  });
});
