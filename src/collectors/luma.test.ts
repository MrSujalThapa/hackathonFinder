import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  describeLumaFailure,
  isRejectedLumaLeadUrl,
  parseLumaHtml,
  resolveLumaFeeds,
  resolveLumaDiscoveryMode,
} from "@/collectors/luma";

const fixturePath = path.join(process.cwd(), "src/collectors/__fixtures__/luma.html");
const nextDataPath = path.join(
  process.cwd(),
  "src/collectors/__fixtures__/luma.next-data.html",
);
const eventPath = path.join(process.cwd(), "src/collectors/__fixtures__/luma.event.html");

describe("parseLumaHtml", () => {
  it("accepts likely hackathons", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseLumaHtml(html, 20);
    assert.ok(leads.some((lead) => (lead.title ?? "").includes("Toronto AI Hackathon")));
    assert.ok(leads.some((lead) => (lead.title ?? "").includes("Remote Agent Buildathon")));
    assert.ok(leads.some((lead) => (lead.title ?? "").includes("Waterloo Student Codefest")));
  });

  it("keeps ordinary meetups for broad human review", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseLumaHtml(html, 20);
    assert.ok(leads.some((lead) => /coffee meetup/i.test(lead.title ?? "")));
  });

  it("excludes old events", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseLumaHtml(html, 20);
    assert.ok(!leads.some((lead) => /Old Toronto Hackathon 2024/i.test(lead.title ?? "")));
  });

  it("parses online events", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseLumaHtml(html, 20);
    const remote = leads.find((lead) => (lead.title ?? "").includes("Remote Agent"));
    assert.ok(remote);
    assert.equal(remote!.metadata?.mode, "online");
    assert.equal(remote!.metadata?.location, "Online");
  });

  it("parses location and date", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseLumaHtml(html, 20);
    const toronto = leads.find((lead) => (lead.title ?? "").includes("Toronto AI Hackathon"));
    assert.ok(toronto);
    assert.match(String(toronto!.metadata?.location ?? ""), /Toronto/i);
    assert.equal(toronto!.metadata?.startDate, "2026-09-13");
  });

  it("preserves external official / apply links", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseLumaHtml(html, 20);
    const toronto = leads.find((lead) => (lead.title ?? "").includes("Toronto AI Hackathon"));
    assert.ok(toronto);
    assert.match(String(toronto!.metadata?.applyUrl ?? ""), /hackto\.example\.com/i);
    assert.ok(toronto!.links.some((link) => /hackto\.example\.com/i.test(link)));
  });

  it("removes duplicate event URLs", () => {
    const html = fs.readFileSync(fixturePath, "utf8");
    const leads = parseLumaHtml(html, 20);
    const toronto = leads.filter((lead) => /toronto-ai-hackathon-2026/i.test(lead.url ?? ""));
    assert.equal(toronto.length, 1);
  });

  it("handles incomplete events safely", () => {
    const html = `<!DOCTYPE html><html><body>
      <article class="event-card">
        <a href="https://lu.ma/minimal-hackathon"><h1>Minimal Hackathon</h1></a>
      </article>
      <article class="event-card"><p>No title</p></article>
    </body></html>`;
    const leads = parseLumaHtml(html, 5);
    assert.equal(leads.length, 1);
    assert.equal(leads[0]?.title, "Minimal Hackathon");
  });

  it("parses __NEXT_DATA__ event embeds and rejects place directories", () => {
    const html = fs.readFileSync(nextDataPath, "utf8");
    const leads = parseLumaHtml(html, 20, "https://luma.com/discover?q=hackathon");
    assert.ok(leads.some((lead) => /Toronto AI Hackathon/i.test(lead.title ?? "")));
    assert.ok(!leads.some((lead) => lead.title === "Toronto"));
    assert.ok(leads.every((lead) => lead.metadata?.provenance === "luma_public"));
  });

  it("parses individual event pages from __NEXT_DATA__", () => {
    const html = fs.readFileSync(eventPath, "utf8");
    const leads = parseLumaHtml(html, 5, "https://luma.com/6xx74n4b");
    assert.equal(leads.length, 1);
    assert.match(leads[0]?.title ?? "", /Code the Cup Hackathon/i);
    assert.equal(leads[0]?.metadata?.organizer, "GDG Toronto");
    assert.equal(leads[0]?.metadata?.registration, "open");
    assert.match(String(leads[0]?.metadata?.location ?? ""), /Toronto/i);
  });

  it("preserves Luma discovery feed provenance", () => {
    const html = fs.readFileSync(eventPath, "utf8");
    const leads = parseLumaHtml(html, 5, "https://luma.com/6xx74n4b", "luma_ai");
    assert.equal(leads[0]?.metadata?.discoveryMode, "luma_ai");
    assert.deepEqual(leads[0]?.metadata?.discoveredFrom, ["luma_ai"]);
  });
});

describe("luma helpers", () => {
  it("uses the Toronto feed for Toronto requests", () => {
    const resolution = resolveLumaFeeds({ requestedLocation: "Toronto" });
    assert.ok(resolution.feeds.some((feed) => feed.url === "https://luma.com/toronto"));
  });

  it("does not use the Toronto feed for Waterloo requests", () => {
    const resolution = resolveLumaFeeds({ requestedLocation: "Waterloo" });
    assert.ok(resolution.feeds.some((feed) => feed.url === "https://luma.com/waterloo"));
    assert.ok(!resolution.feeds.some((feed) => feed.url === "https://luma.com/toronto"));
  });

  it("keeps topic feeds available for Waterloo requests", () => {
    const resolution = resolveLumaFeeds({ requestedLocation: "Waterloo" });
    assert.ok(resolution.feeds.some((feed) => feed.url === "https://luma.com/tech"));
    assert.ok(resolution.feeds.some((feed) => feed.url === "https://luma.com/ai"));
  });

  it("uses explicit fallback when no verified city feed exists", () => {
    const resolution = resolveLumaFeeds({ requestedLocation: "London" });
    assert.match(resolution.fallbackReason ?? "", /No verified London city feed/i);
    assert.ok(resolution.feeds.every((feed) => feed.type === "topic"));
  });

  it("rejects discover/calendar/profile URLs as leads", () => {
    assert.equal(isRejectedLumaLeadUrl("https://luma.com/discover?q=hackathon"), true);
    assert.equal(isRejectedLumaLeadUrl("https://luma.com/home/calendars"), true);
    assert.equal(isRejectedLumaLeadUrl("https://luma.com/signin"), true);
    assert.equal(isRejectedLumaLeadUrl("https://luma.com/6xx74n4b"), false);
  });

  it("defaults to public mode and stubs authenticated", () => {
    assert.equal(resolveLumaDiscoveryMode({} as unknown as NodeJS.ProcessEnv), "public");
    assert.equal(
      resolveLumaDiscoveryMode({ LUMA_MODE: "" } as unknown as NodeJS.ProcessEnv),
      "public",
    );
    assert.equal(
      resolveLumaDiscoveryMode({ LUMA_MODE: "authenticated" } as unknown as NodeJS.ProcessEnv),
      "authenticated",
    );
  });

  it("formats failure categories for health classification", () => {
    assert.match(describeLumaFailure("zero_matching_results"), /no likely hackathon/i);
    assert.match(describeLumaFailure("auth_required"), /authentication required/i);
  });
});
