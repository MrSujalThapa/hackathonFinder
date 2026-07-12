import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parseMlhHtml } from "@/collectors/mlh";
import { emptyCollectorResult } from "@/collectors/types";

const fixturePath = path.join(process.cwd(), "src/collectors/__fixtures__/mlh.html");
const FIXED_NOW = new Date("2026-07-11T12:00:00Z");

describe("parseMlhHtml", () => {
  it("extracts multiple upcoming events from fixture HTML", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseMlhHtml(html, 20, { now: FIXED_NOW, seasonYear: 2026 });
    assert.ok(leads.length >= 3);
    assert.ok(leads.some((lead) => (lead.title ?? "").includes("Toronto AI")));
  });

  it("handles online / digital-only events", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseMlhHtml(html, 20, { now: FIXED_NOW, seasonYear: 2026 });
    const remote = leads.find((lead) => (lead.title ?? "").includes("Global Remote"));
    assert.ok(remote);
    assert.equal(remote!.metadata?.mode, "online");
    assert.equal(remote!.metadata?.location, "Online");
  });

  it("handles in-person location", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseMlhHtml(html, 20, { now: FIXED_NOW, seasonYear: 2026 });
    const toronto = leads.find((lead) => (lead.title ?? "").includes("Toronto AI"));
    assert.ok(toronto);
    assert.equal(toronto!.metadata?.mode, "in-person");
    assert.match(String(toronto!.metadata?.location ?? ""), /Toronto/i);
  });

  it("parses date ranges into start/end dates", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseMlhHtml(html, 20, { now: FIXED_NOW, seasonYear: 2026 });
    const toronto = leads.find((lead) => (lead.title ?? "").includes("Toronto AI"));
    assert.equal(toronto!.metadata?.startDate, "2026-07-18");
    assert.equal(toronto!.metadata?.endDate, "2026-07-20");
  });

  it("dedupes repeated event URLs", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseMlhHtml(html, 20, { now: FIXED_NOW, seasonYear: 2026 });
    const toronto = leads.filter((lead) => /toronto-ai-hack/i.test(lead.url ?? ""));
    assert.equal(toronto.length, 1);
  });

  it("tolerates incomplete cards", () => {
    const html = `<!DOCTYPE html><html><body>
      <div class="event-wrapper">
        <a class="event-link" href="https://events.mlh.io/events/42-minimal">
          <div class="event"><h3 class="event-name">Minimal MLH Event</h3></div>
        </a>
      </div>
    </body></html>`;
    const leads = parseMlhHtml(html, 5, { now: FIXED_NOW, seasonYear: 2026 });
    assert.equal(leads.length, 1);
    assert.equal(leads[0]?.title, "Minimal MLH Event");
  });

  it("skips clearly past events when dates parse", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseMlhHtml(html, 20, { now: FIXED_NOW, seasonYear: 2026 });
    assert.ok(!leads.some((lead) => (lead.title ?? "").includes("Past Spring")));
  });

  it("parses Inertia upcomingEvents JSON embedded in MLH pages", () => {
    const html = `<!DOCTYPE html><html><body>
      <script data-page="app" type="application/json">${JSON.stringify({
        component: "EventsListing",
        props: {
          upcomingEvents: [
            {
              id: "1",
              slug: "toronto-ai-2026",
              name: "Toronto AI Hackathon Inertia",
              status: "upcoming",
              startsAt: "2026-09-13T12:00:00Z",
              endsAt: "2026-09-15T23:59:59Z",
              dateRange: "SEP 13 - 15",
              url: "/events/toronto-ai-2026/prizes",
              location: "Toronto, Canada",
              formatType: "physical",
              websiteUrl: "https://hackto.example.com/ai",
            },
            {
              id: "2",
              slug: "ended-event",
              name: "Ended Event",
              status: "ended",
              startsAt: "2026-01-01T00:00:00Z",
              endsAt: "2026-01-02T00:00:00Z",
              url: "/events/ended-event",
              location: "Montreal, Canada",
              formatType: "physical",
            },
          ],
        },
      })}</script>
    </body></html>`;
    const leads = parseMlhHtml(html, 20, { now: FIXED_NOW, seasonYear: 2026 });
    assert.equal(leads.length, 1);
    assert.equal(leads[0]?.title, "Toronto AI Hackathon Inertia");
    assert.equal(leads[0]?.metadata?.startDate, "2026-09-13");
    assert.equal(leads[0]?.metadata?.mode, "in-person");
  });

  it("zero-card HTML yields no leads and supports a warning result", () => {
    const leads = parseMlhHtml("<html><body><p>No events</p></body></html>", 10, {
      now: FIXED_NOW,
      seasonYear: 2026,
    });
    assert.equal(leads.length, 0);

    const result = emptyCollectorResult("mlh");
    result.warnings.push("MLH returned no upcoming event cards.");
    assert.equal(result.leads.length, 0);
    assert.match(result.warnings[0] ?? "", /no upcoming event cards/i);
  });
});
