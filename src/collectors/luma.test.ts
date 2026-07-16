import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  allocateLumaFeedBudgets,
  describeLumaFailure,
  extractLumaTimelineCards,
  isLumaFeedThemeCandidate,
  isRejectedLumaLeadUrl,
  leadContentMatchesTheme,
  lumaBudgetForProfile,
  parseLumaHtml,
  resolveLumaTimelineHeadingDate,
  resolveLumaFeeds,
  resolveLumaDiscoveryMode,
} from "@/collectors/luma";
import * as cheerio from "cheerio";

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

  it("inherits visible timeline headings for rendered feed cards", () => {
    const html = `<!doctype html><html><body><main>
      <h2>Tomorrow</h2>
      <a class="event-link" href="/agent-hack"><h3>Agent Hackathon</h3><span>6:00 PM</span><span>Online</span></a>
      <h2>August 4</h2>
      <a class="event-link" href="/waterloo-build"><h3>Waterloo Buildathon</h3><span>Waterloo</span></a>
    </main></body></html>`;
    const now = new Date(Date.UTC(2026, 6, 15));
    const leads = parseLumaHtml(html, 10, "https://luma.com/tech", "luma_tech", now);
    const agent = leads.find((lead) => lead.title === "Agent Hackathon");
    const waterloo = leads.find((lead) => lead.title === "Waterloo Buildathon");
    assert.equal(agent?.metadata?.startDate, "2026-07-16");
    assert.equal(agent?.metadata?.timelineHeading, "Tomorrow");
    assert.equal(waterloo?.metadata?.startDate, "2026-08-04");
    assert.equal(waterloo?.metadata?.dateExtractionState, "found_on_listing_timeline");
  });

  it("maps timeline proposals back to existing DOM cards only", () => {
    const $ = cheerio.load(`<!doctype html><html><body>
      <h2>Friday</h2>
      <article class="event-card"><a href="/friday-hack"><h3>Friday Hack Night</h3></a><time>7 PM</time></article>
    </body></html>`);
    const cards = extractLumaTimelineCards($, "https://luma.com/tech", new Date(Date.UTC(2026, 6, 15)));
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.startDate, "2026-07-17");
    assert.equal(cards[0]?.timelineHeading, "Friday");
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
    assert.ok(resolution.feeds.some((feed) => /discover\?q=hackathon/i.test(feed.url)));
  });

  it("uses multiple AI/hackathon searches before Tech for AI queries", () => {
    const resolution = resolveLumaFeeds({
      requestedTopics: ["AI"],
      rawCommand: "find AI hackathons from Luma",
    });
    const topicUrls = resolution.feeds.filter((feed) => feed.type === "topic").map((feed) => feed.url);
    assert.ok(topicUrls.some((url) => /discover\?q=hackathon/i.test(url)));
    assert.ok(topicUrls.some((url) => /AI%20hackathon|AI\+hackathon/i.test(url)));
    assert.ok(topicUrls.some((url) => /artificial/i.test(url)));
    assert.ok(topicUrls.indexOf("https://luma.com/tech") === topicUrls.length - 1 ||
      topicUrls.indexOf("https://luma.com/tech") > topicUrls.indexOf("https://luma.com/ai"));
    assert.ok(topicUrls.indexOf("https://luma.com/tech") > 0);
  });

  it("reserves independent per-route budgets without starving later feeds", () => {
    const total = lumaBudgetForProfile("deep", 50);
    const parts = allocateLumaFeedBudgets(total, 5);
    assert.equal(parts.length, 5);
    assert.ok(parts.every((part) => part.maxScrolls >= 4));
    assert.ok(parts[0]!.maxScrolls - parts[4]!.maxScrolls <= 1);
    assert.equal(
      parts.reduce((sum, part) => sum + part.maxScrolls, 0),
      total.maxScrolls,
    );
  });

  it("uses explicit fallback when no verified city feed exists", () => {
    const resolution = resolveLumaFeeds({ requestedLocation: "London" });
    assert.match(resolution.fallbackReason ?? "", /No verified London city feed/i);
    assert.ok(resolution.feeds.every((feed) => feed.type === "topic"));
  });

  it("allocates per-feed scroll budgets instead of one shared pool", () => {
    const total = lumaBudgetForProfile("deep", 50);
    const parts = allocateLumaFeedBudgets(total, 3);
    assert.equal(parts.length, 3);
    assert.ok(parts.every((part) => part.maxScrolls < total.maxScrolls));
    assert.equal(
      parts.reduce((sum, part) => sum + part.maxScrolls, 0),
      total.maxScrolls,
    );
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

  it("uses deeper Luma scroll and detail budgets for deep profiles", () => {
    const light = lumaBudgetForProfile("light", 50);
    const deep = lumaBudgetForProfile("deep", 50);
    assert.ok(deep.maxEvents > light.maxEvents);
    assert.ok(deep.maxScrolls > light.maxScrolls);
    assert.ok(deep.detailLimit > light.detailLimit);
    assert.equal(deep.targetEvents, 100);
    assert.ok(light.maxEvents < 100);
    assert.ok(light.targetEvents < 100);
  });

  it("targets at least 100 unique events for deep Luma without forcing 200", () => {
    const deep = lumaBudgetForProfile("deep", 50);
    assert.ok(deep.targetEvents >= 100);
    assert.ok(deep.maxEvents >= 100);
    assert.equal(deep.stopAtTarget, false);
  });

  it("separates feed-theme provenance from content-theme matches", () => {
    const feedOnly = {
      id: "luma-dance",
      source: "luma" as const,
      title: "REUNION Dance Party Rooftop",
      text: "Luma public event - discovered from luma_ai, luma_tech",
      links: [],
      postedAt: new Date().toISOString(),
      metadata: {
        discoveredFrom: ["luma_ai", "luma_tech"],
        description: "An outdoor dance social",
      },
    };
    assert.equal(
      isLumaFeedThemeCandidate(feedOnly.metadata.discoveredFrom, ["AI"], "AI hackathons"),
      true,
    );
    assert.equal(leadContentMatchesTheme(feedOnly, ["AI"]), false);

    const contentHit = {
      id: "luma-ai-hack",
      source: "luma" as const,
      title: "Build with AI: Code the Cup Hackathon",
      text: "Luma public event - discovered from luma_toronto",
      links: [],
      postedAt: new Date().toISOString(),
      metadata: {
        discoveredFrom: ["luma_toronto"],
        description: "Hackathon for AI builders",
      },
    };
    assert.equal(
      isLumaFeedThemeCandidate(contentHit.metadata.discoveredFrom, ["AI"], "AI hackathons"),
      false,
    );
    assert.equal(leadContentMatchesTheme(contentHit, ["AI"]), true);

    const pairs = {
      id: "luma-pairs",
      source: "luma" as const,
      title: "PAIRS",
      text: "Luma public event - discovered from luma_ai",
      links: [],
      postedAt: new Date().toISOString(),
      metadata: { discoveredFrom: ["luma_ai"] },
    };
    assert.equal(leadContentMatchesTheme(pairs, ["AI"]), false);
    assert.equal(leadContentMatchesTheme(pairs, []), false);
  });

  it("resolves relative timeline headings from crawl date", () => {
    const now = new Date(Date.UTC(2026, 6, 15));
    assert.equal(resolveLumaTimelineHeadingDate("Today", now), "2026-07-15");
    assert.equal(resolveLumaTimelineHeadingDate("This Weekend", now), "2026-07-18");
    assert.equal(resolveLumaTimelineHeadingDate("August 4", now), "2026-08-04");
  });
});
