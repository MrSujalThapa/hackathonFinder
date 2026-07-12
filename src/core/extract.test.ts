import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mockCollector } from "@/collectors/mock";
import { classifyHackathonEvent } from "@/core/classifyEventPage";
import {
  extractHackathonEvent,
  extractHackathonEvents,
  sanitizeEvidenceRaw,
} from "@/core/extract";
import { verifyHackathonEvent } from "@/core/verify";
import type { RawLead } from "@/core/discovery/types";
import { getDefaultDiscoveryPreferences } from "@/agent/parseCommand";

describe("extractHackathonEvents", () => {
  it("extracts structured events from mock leads", async () => {
    const result = await mockCollector.collect({
      preferences: getDefaultDiscoveryPreferences("find upcoming hackathons"),
      maxResults: 25,
      timeoutMs: 15_000,
      dryRun: true,
    });
    const events = extractHackathonEvents(result.leads);
    assert.equal(events.length, result.leads.length);
    assert.ok(events.some((event) => event.name === "HackTO AI Challenge"));
    assert.ok(events[0]?.evidence.length > 0);
  });
});

describe("extract X lead official vs social", () => {
  it("keeps outbound official URL and always emits x_post evidence", () => {
    const postUrl = "https://x.com/hackorg/status/99";
    const official = "https://hack.utoronto.edu/ai-2026";
    const lead: RawLead = {
      id: "x-99",
      source: "x",
      title: "UofT AI Hackathon 2026",
      url: postUrl,
      text: `Apply at ${official}. Deadline 2026-08-01. Toronto in-person.`,
      links: [postUrl, official, `${official}/apply`],
      postedAt: "2026-07-01T00:00:00Z",
      metadata: {
        socialUrl: postUrl,
        officialUrl: official,
        applyUrl: `${official}/apply`,
        mode: "in-person",
        city: "Toronto",
        country: "Canada",
        deadline: "2026-08-01",
        startDate: "2026-09-12",
      },
    };

    const event = extractHackathonEvent(lead);
    assert.ok(event);
    assert.equal(event.officialUrl, official);
    assert.equal(event.socialUrl, postUrl);
    assert.ok(!event.officialUrl?.includes("x.com"));
    assert.ok(event.evidence.some((e) => e.type === "official_page" && e.url === official));
    assert.ok(event.evidence.some((e) => e.type === "x_post" && e.url === postUrl));
    assert.equal(verifyHackathonEvent(event).status, "accepted");
  });

  it("social-only X lead extracts to needs_review via verify", () => {
    const postUrl = "https://x.com/hackleads/status/123";
    const lead: RawLead = {
      id: "x-123",
      source: "x",
      title: "Maybe a hackathon?",
      url: postUrl,
      text: "Heard there might be a cool AI hackathon soon. DM for details.",
      links: [postUrl],
      postedAt: "2026-07-01T00:00:00Z",
      metadata: { socialUrl: postUrl, themes: ["AI"] },
    };

    const event = extractHackathonEvent(lead);
    assert.ok(event);
    assert.equal(event.officialUrl, undefined);
    assert.equal(event.socialUrl, postUrl);
    assert.ok(event.evidence.every((e) => e.type === "x_post"));
    assert.equal(verifyHackathonEvent(event).status, "needs_review");
  });

  it("directory outbound URL is classified as EVENT_DIRECTORY", () => {
    const postUrl = "https://x.com/org/status/55";
    const directory = "https://devpost.com/hackathons";
    const lead: RawLead = {
      id: "x-55",
      source: "x",
      title: "Browse AI hackathons on Devpost",
      url: postUrl,
      text: `Many hackathons listed here ${directory}`,
      links: [postUrl, directory],
      postedAt: "2026-07-01T00:00:00Z",
      metadata: {
        socialUrl: postUrl,
        officialUrl: directory,
      },
    };

    const event = extractHackathonEvent(lead);
    assert.ok(event);
    assert.equal(event.officialUrl, directory);
    assert.equal(event.socialUrl, postUrl);
    const classified = classifyHackathonEvent(event);
    assert.equal(classified.classification, "EVENT_DIRECTORY");
  });

  it("never dumps bearer tokens into evidence raw", () => {
    const sanitized = sanitizeEvidenceRaw({
      leadId: "x-1",
      bearerToken: "secret-token-value",
      authorization: "Bearer abc.def.ghi",
      nested: { apiKey: "sk-live-123", note: "ok" },
      snippet: "Authorization: Bearer leaked-token-here",
    });

    assert.equal(sanitized.bearerToken, undefined);
    assert.equal(sanitized.authorization, undefined);
    assert.deepEqual(sanitized.nested, { note: "ok" });
    assert.equal(sanitized.snippet, "[redacted]");

    const postUrl = "https://x.com/org/status/1";
    const lead: RawLead = {
      id: "x-1",
      source: "x",
      title: "Hack day",
      url: postUrl,
      text: "Come hack",
      links: [postUrl],
      postedAt: "2026-07-01T00:00:00Z",
      metadata: {
        socialUrl: postUrl,
        bearerToken: "should-not-appear",
        X_BEARER_TOKEN: "also-secret",
      },
    };
    const event = extractHackathonEvent(lead);
    assert.ok(event);
    const rawBlob = JSON.stringify(event.evidence);
    assert.equal(/should-not-appear|also-secret|Bearer/i.test(rawBlob), false);
  });
});
