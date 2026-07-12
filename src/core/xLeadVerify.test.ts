import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RawLead } from "@/core/discovery/types";
import {
  collectXOutboundUrls,
  isLikelyDirectoryUrl,
  isXSocialUrl,
  pickBestOfficialUrlForXLead,
  resolveXSocialUrl,
  softSearchOfficialUrlForXLead,
} from "@/core/xLeadVerify";
import { createMockSearchProvider } from "@/lib/search/providers/mock";

function xLead(partial: Partial<RawLead> = {}): RawLead {
  return {
    id: "x-1",
    source: "x",
    title: "AI Hackathon announcement",
    url: "https://x.com/org/status/1",
    text: "Apply now",
    links: ["https://x.com/org/status/1"],
    postedAt: "2026-07-01T00:00:00Z",
    metadata: { socialUrl: "https://x.com/org/status/1" },
    ...partial,
  };
}

describe("xLeadVerify URL helpers", () => {
  it("detects social hosts including t.co", () => {
    assert.equal(isXSocialUrl("https://x.com/a/status/1"), true);
    assert.equal(isXSocialUrl("https://twitter.com/a/status/1"), true);
    assert.equal(isXSocialUrl("https://t.co/abc"), true);
    assert.equal(isXSocialUrl("https://devpost.com/software/x"), false);
  });

  it("collects outbound URLs from links and text, excluding social", () => {
    const lead = xLead({
      text: "Details https://hack.example.edu/2026 and https://t.co/x",
      links: ["https://x.com/org/status/1", "https://lu.ma/ai-hack"],
    });
    const urls = collectXOutboundUrls(lead);
    assert.ok(urls.some((u) => /hack\.example\.edu/.test(u)));
    assert.ok(urls.some((u) => /lu\.ma/.test(u)));
    assert.ok(!urls.some((u) => isXSocialUrl(u)));
  });

  it("prefers apply/devpost/mlh/luma/edu over generic outbound", () => {
    const lead = xLead({
      links: [
        "https://x.com/org/status/1",
        "https://blog.example.com/post",
        "https://devpost.com/software/toronto-ai-hack/apply",
      ],
    });
    const picked = pickBestOfficialUrlForXLead(lead);
    assert.match(String(picked), /devpost\.com/i);
  });

  it("returns undefined for social-only leads", () => {
    const lead = xLead({
      links: ["https://x.com/org/status/1"],
      text: "Heard there might be a cool hackathon soon",
    });
    assert.equal(pickBestOfficialUrlForXLead(lead), undefined);
    assert.equal(resolveXSocialUrl(lead), "https://x.com/org/status/1");
  });

  it("flags directory destinations", () => {
    assert.equal(isLikelyDirectoryUrl("https://devpost.com/hackathons"), true);
    assert.equal(isLikelyDirectoryUrl("https://hackthenorth.com/"), false);
  });

  it("soft search assist finds a non-social URL when provider is available", async () => {
    const lead = xLead({
      title: "Toronto Agent Hack 2026",
      text: "Applications open soon",
      links: ["https://x.com/org/status/1"],
    });
    const found = await softSearchOfficialUrlForXLead(lead, {
      searchProvider: createMockSearchProvider({
        results: [
          {
            title: "Toronto Agent Hack",
            url: "https://hack.utoronto.edu/agent-2026",
            snippet: "Apply now",
            source: "mock",
          },
        ],
      }),
    });
    assert.match(String(found), /utoronto\.edu/i);
  });

  it("soft search returns undefined when provider missing (no crash)", async () => {
    const lead = xLead({
      links: ["https://x.com/org/status/1"],
      text: "Applications open",
    });
    assert.equal(await softSearchOfficialUrlForXLead(lead, { searchProvider: null }), undefined);
  });
});
