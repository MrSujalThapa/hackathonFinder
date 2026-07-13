import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCustomSourceHtml } from "@/collectors/customSource";
import type { CustomSource } from "@/server/customSources/types";

function source(overrides: Partial<CustomSource> = {}): CustomSource {
  return {
    id: "custom-1",
    name: "Hacker Calendar",
    slug: "hacker-calendar",
    baseUrl: "https://example.com",
    listingUrl: "https://example.com/hackathons",
    mode: "static",
    enabled: true,
    locationScope: "global",
    topicScope: ["hackathon"],
    maxItems: 100,
    status: "unknown",
    lastCheckedAt: null,
    lastErrorSafe: null,
    selectors: {},
    createdAt: "2026-07-13T00:00:00Z",
    updatedAt: "2026-07-13T00:00:00Z",
    ...overrides,
  };
}

describe("parseCustomSourceHtml", () => {
  it("parses static event listings and preserves custom provenance", () => {
    const leads = parseCustomSourceHtml(
      `<article>
        <a href="/events/waterloo-hack"><h2>Waterloo AI Hackathon</h2></a>
        <time>Aug 12, 2026</time>
        <p>Hackathon challenge in Waterloo.</p>
      </article>`,
      source(),
    );
    assert.equal(leads.length, 1);
    assert.equal(leads[0]?.source, "web");
    assert.equal(leads[0]?.metadata?.attribution, "custom:hacker-calendar");
    assert.ok((leads[0]?.metadata?.sourceIds as Record<string, unknown>)["custom:hacker-calendar"]);
  });

  it("deduplicates URLs and honors the 100 item cap", () => {
    const html = Array.from({ length: 110 }, (_value, index) => {
      const id = index === 2 ? 1 : index;
      return `<article><a href="/e/${id}"><h2>Hackathon ${id}</h2></a><p>Event challenge 2026</p></article>`;
    }).join("");
    const leads = parseCustomSourceHtml(html, source({ maxItems: 100 }));
    assert.equal(leads.length, 100);
    assert.equal(new Set(leads.map((lead) => lead.url)).size, 100);
  });

  it("returns no leads for malformed non-event pages", () => {
    const leads = parseCustomSourceHtml(
      `<main><a href="/about">About us</a><p>Company profile</p></main>`,
      source(),
    );
    assert.equal(leads.length, 0);
  });
});
