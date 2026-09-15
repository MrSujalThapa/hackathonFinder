import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTinyFishSearchProvider } from "@/lib/search/providers/tinyfish";

async function withFetch(
  response: { status?: number; body?: unknown; throws?: Error },
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    if (response.throws) throw response.throws;
    return new Response(JSON.stringify(response.body ?? {}), { status: response.status ?? 200 });
  }) as typeof fetch;
  try { await run(); } finally { globalThis.fetch = original; }
}

describe("TinyFish via Monid", () => {
  it("normalizes results, maps dates/location, and dedupes URLs", async () => {
    await withFetch({ body: { status: "COMPLETED", runId: "run_1", providerResponse: { httpStatus: 200 }, output: { results: [
      { title: "One", url: "https://example.com/a", snippet: "first", published_date: "2026-01-01" },
      { title: "Duplicate", url: "https://example.com/a" },
      { title: "Two", link: "https://other.example/b", description: "second" },
    ] } } }, async () => {
      const result = await createTinyFishSearchProvider("secret").search({ query: "AI", maxResults: 5, dateFrom: "2026-01-01", dateTo: "2026-02-01", location: "Ottawa" });
      assert.equal(result.length, 2);
      assert.equal(result[0]?.source, "example.com");
      assert.equal(result[0]?.publishedAt, "2026-01-01");
    });
  });

  it("handles zero results, provider errors, and Monid rate limits", async () => {
    await withFetch({ body: { status: "COMPLETED", providerResponse: { httpStatus: 200 }, output: [] } }, async () => {
      assert.deepEqual(await createTinyFishSearchProvider("secret").search({ query: "none", maxResults: 2 }), []);
    });
    await withFetch({ body: { status: "COMPLETED", providerResponse: { httpStatus: 429 }, output: [] } }, async () => {
      await assert.rejects(() => createTinyFishSearchProvider("secret").search({ query: "x", maxResults: 1, timeoutMs: 1 }), /rate limited/);
    });
    await withFetch({ status: 429 }, async () => {
      await assert.rejects(() => createTinyFishSearchProvider("secret").search({ query: "x", maxResults: 1, timeoutMs: 1 }), /Monid HTTP 429/);
    });
  });
});
