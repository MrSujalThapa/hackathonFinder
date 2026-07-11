import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createWebSearchCollector,
  isPromisingSearchResult,
  searchResultsToLeads,
} from "@/collectors/webSearch";
import { createMockSearchProvider } from "@/lib/search/providers/mock";
import type { DiscoveryPreferences } from "@/core/discovery/types";
import { SearchProviderError } from "@/lib/search/types";

const preferences: DiscoveryPreferences = {
  rawCommand: "find AI hackathons in Toronto or remote",
  locations: ["Toronto", "Canada", "Remote"],
  dateFrom: "2026-07-01",
  dateTo: "2026-12-31",
  themes: ["AI", "agents"],
  modes: ["online", "in-person"],
  sources: ["web"],
  includeRemote: true,
  includeInPerson: true,
  maxResults: 10,
};

describe("web search filtering", () => {
  it("preserves official / event results and filters article noise", () => {
    assert.equal(
      isPromisingSearchResult({
        title: "Toronto AI Hackathon — Apply",
        url: "https://hackto.example.com/ai",
        snippet: "Registration open for builders",
        source: "hackto.example.com",
      }),
      true,
    );
    assert.equal(
      isPromisingSearchResult({
        title: "What is a hackathon? Wikipedia",
        url: "https://example.com/blog/what-is-a-hackathon",
        snippet: "Opinion tips for beginners",
        source: "example.com",
      }),
      false,
    );
  });

  it("merges results from multiple queries and dedupes canonical URLs", () => {
    const leads = searchResultsToLeads(
      [
        {
          title: "Event A",
          url: "https://www.example.com/hack/?utm_source=x",
          snippet: "hackathon apply",
          source: "example.com",
          query: "q1",
        },
        {
          title: "Event A dup",
          url: "https://example.com/hack",
          snippet: "hackathon apply",
          source: "example.com",
          query: "q2",
        },
        {
          title: "MLH listing",
          url: "https://mlh.io/seasons/2026/events",
          snippet: "upcoming hackathons",
          source: "mlh.io",
          query: "q2",
        },
      ],
      10,
    );

    assert.equal(leads.length, 2);
    assert.ok(leads.every((lead) => lead.metadata?.query));
  });

  it("respects maxResults", () => {
    const leads = searchResultsToLeads(
      Array.from({ length: 8 }, (_, i) => ({
        title: `Hack ${i}`,
        url: `https://events.example.com/hack-${i}`,
        snippet: "hackathon registration open",
        source: "events.example.com",
        query: "q",
      })),
      3,
    );
    assert.equal(leads.length, 3);
  });
});

describe("webSearchCollector", () => {
  it("handles missing provider config with a warning", async () => {
    const collector = createWebSearchCollector({ provider: null });
    const result = await collector.collect({
      preferences,
      maxResults: 5,
      timeoutMs: 5_000,
      dryRun: true,
    });
    assert.equal(result.leads.length, 0);
    assert.match(result.warnings.join(" "), /SEARCH_PROVIDER|not configured/i);
    assert.equal(result.errors.length, 0);
  });

  it("handles provider failure without failing the collector hard", async () => {
    const collector = createWebSearchCollector({
      provider: createMockSearchProvider({
        handler: async () => {
          throw new SearchProviderError("boom", "mock");
        },
      }),
    });
    const result = await collector.collect({
      preferences,
      maxResults: 5,
      timeoutMs: 5_000,
      dryRun: true,
    });
    assert.equal(result.errors.length, 0);
    assert.ok(result.warnings.length > 0);
  });

  it("records query evidence on leads", async () => {
    const collector = createWebSearchCollector({
      provider: createMockSearchProvider({
        handler: async (input) => [
          {
            title: `Result for ${input.query}`,
            url: `https://official.example.com/${encodeURIComponent(input.query.slice(0, 12))}`,
            snippet: "AI hackathon registration deadline apply",
            source: "official.example.com",
          },
        ],
      }),
    });
    const result = await collector.collect({
      preferences,
      maxResults: 5,
      timeoutMs: 8_000,
      dryRun: true,
    });
    assert.ok(result.leads.length >= 1);
    assert.ok(result.leads[0]?.metadata?.query);
    assert.ok(result.leads[0]?.metadata?.snippet);
  });
});
