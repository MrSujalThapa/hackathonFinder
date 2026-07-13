import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectCustomPageShape, parseCustomSourceHtml } from "@/collectors/customSource";
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

  it("extracts Hackathon Map style repeated event sections", () => {
    const leads = parseCustomSourceHtml(
      `<div id="hackathon-items-root">
        <div id="hackathon-1" class="hackathon-item Everywhere Online True">
          <div class="row align-items-center">
            <div class="col-7"><h5 class="mb-0">Agentic AI Innovation Challenge 2026</h5></div>
            <div class="col-5 small text-end">July 15, 2026</div>
          </div>
          <div class="row mt-2"><div class="col">Everywhere, Online<br>Starts: July 15, 2026</div></div>
          <div class="row mt-2"><div class="col small"><strong>Prizes:</strong> $3,000</div></div>
          <a href="https://challenge.example.com" class="btn">Website</a>
          <a href="https://maps.example.com/place" class="btn">Directions</a>
          <span class="badge">Online</span><span class="badge">Upcoming</span>
        </div>
        <a href="/add_hackathon">Add a Hackathon</a>
      </div>`,
      source({ slug: "hackathonmap", listingUrl: "https://hackathonmap.com/" }),
    );
    assert.equal(leads.length, 1);
    assert.equal(leads[0]?.title, "Agentic AI Innovation Challenge 2026");
    assert.equal(leads[0]?.url, "https://challenge.example.com/");
    assert.equal(leads[0]?.metadata?.discoveryMode, "custom_static_event_sections");
    assert.equal(leads[0]?.metadata?.location, "Everywhere, Online");
    assert.equal(leads[0]?.metadata?.format, "online");
  });

  it("marks materially conflicting Hackathon Map dates for review", () => {
    const leads = parseCustomSourceHtml(
      `<div id="hackathon-items-root">
        <div id="hackathon-1" class="hackathon-item">
          <h5>Global Hack Week: Season Launch</h5>
          <div class="text-end">July 10, 2026</div>
          <div class="row mt-2"><div class="col">Everywhere, Worldwide<br>Starts: July 04, 2025</div></div>
          <a href="https://events.mlh.io/events/14284-global-hack-week-season-launch">Website</a>
          <span class="badge">Online</span>
        </div>
      </div>`,
      source({ slug: "hackathonmap", listingUrl: "https://hackathonmap.com/" }),
    );
    assert.equal(leads.length, 1);
    assert.deepEqual(leads[0]?.metadata?.reviewReasons, ["DATE_CONFLICT"]);
  });

  it("extracts public Hackathon Radar style table rows without descriptions", () => {
    const html = `<table>
      <thead><tr>
        <th>Platform</th><th>Title</th><th>Type</th><th>Start Date</th>
        <th>Participants</th><th>Prize Pool</th><th>Sponsors</th><th>Website</th>
      </tr></thead>
      <tbody>
        <tr>
          <td><img alt="devfolio"></td>
          <td><div>RNS Hack_Overflow 2.0</div></td>
          <td>in-person</td>
          <td>16/07/2026</td>
          <td>5,402</td>
          <td>TBD</td>
          <td>Polygon +2 more</td>
          <td><a href="https://rns-hackoverflow-2.devfolio.co/">rns-hackoverflow-2...</a></td>
        </tr>
        <tr>
          <td></td>
          <td>Prometheus July AI Challenge</td>
          <td>online</td>
          <td>17/07/2026</td>
          <td>89</td>
          <td>1,500 $</td>
          <td>-</td>
          <td><a href="https://prometheus-july-ai-challenge.devpost.com/">prometheus-july-ai...</a></td>
        </tr>
      </tbody>
    </table>
    <p>208 more upcoming hackathons hidden</p>`;
    const leads = parseCustomSourceHtml(
      html,
      source({ slug: "hackathonradar", listingUrl: "https://www.hackathonradar.com/database", mode: "playwright" }),
    );
    assert.equal(leads.length, 2);
    assert.equal(leads[0]?.metadata?.discoveryMode, "custom_data_table");
    assert.equal(leads[0]?.url, "https://rns-hackoverflow-2.devfolio.co/");
    assert.equal(leads[0]?.metadata?.startDateRaw, "16/07/2026");
    assert.equal(leads[0]?.metadata?.participantsRaw, "5,402");
    assert.equal(leads[0]?.metadata?.prizeSummary, "TBD");
    assert.equal(leads[1]?.metadata?.format, "online");
  });

  it("deduplicates table rows by real href and detects data table shape", () => {
    const html = `<table>
      <tr><th>Title</th><th>Start Date</th><th>Website</th></tr>
      <tr><td>Build with Gemma</td><td>17/07/2026</td><td><a href="https://build.example.com/full-url">build-with-gemma...</a></td></tr>
      <tr><td>Build with Gemma</td><td>17/07/2026</td><td><a href="https://build.example.com/full-url">build-with-gemma...</a></td></tr>
    </table>`;
    const custom = source({ slug: "hackathonradar" });
    const leads = parseCustomSourceHtml(html, custom);
    assert.equal(leads.length, 1);
    assert.equal(leads[0]?.url, "https://build.example.com/full-url");
    const shape = detectCustomPageShape(html, custom);
    assert.equal(shape.primaryStrategy, "data_table");
    assert.deepEqual(shape.evidence.headers, ["Title", "Start Date", "Website"]);
  });
});
