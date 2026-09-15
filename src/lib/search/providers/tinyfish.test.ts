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
  it("normalizes results, maps dates, and dedupes URLs", async () => {
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

  it("maps SearchRequest filters into the TinyFish Monid input", async () => {
    const original = globalThis.fetch;
    let sent: { provider: string; endpoint: string; input: Record<string, unknown> } | undefined;
    globalThis.fetch = (async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        status: "COMPLETED",
        providerResponse: { httpStatus: 200 },
        output: [],
      }));
    }) as typeof fetch;
    try {
      await createTinyFishSearchProvider("secret").search({
        query: "AI hackathons",
        maxResults: 5,
        dateFrom: "2027-01-01",
        dateTo: "2027-02-01",
        location: "Canada",
      });
      assert.deepEqual(sent, {
        provider: "tinyfish",
        endpoint: "/search",
        input: {
          queryParams: {
            query: "AI hackathons",
            page: 0,
            after_date: "2027-01-01",
            before_date: "2027-02-01",
            location: "CA",
            language: "en",
            domain_type: "web",
          },
        },
      });
    } finally {
      globalThis.fetch = original;
    }
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
    await withFetch({ body: { status: "COMPLETED" } }, async () => {
      await assert.rejects(() => createTinyFishSearchProvider("secret").search({ query: "x", maxResults: 1 }), /omitted output/);
    });
  });

  it("uses bounded pages when the requested result count exceeds one page", async () => {
    const original = globalThis.fetch;
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { input: { queryParams: { page: number } } };
      bodies.push(body as unknown as Record<string, unknown>);
      return new Response(JSON.stringify({
        status: "COMPLETED",
        providerResponse: { httpStatus: 200 },
        output: Array.from({ length: 20 }, (_, index) => ({
          title: `Result ${body.input.queryParams.page}-${index}`,
          url: `https://example.com/${body.input.queryParams.page}-${index}`,
        })),
      }));
    }) as typeof fetch;
    try {
      const results = await createTinyFishSearchProvider("secret").search({ query: "AI", maxResults: 25 });
      assert.equal(results.length, 25);
      assert.deepEqual(bodies.map((body) => (body.input as { queryParams: { page: number } }).queryParams.page), [0, 1]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("polls an asynchronous Monid run until TinyFish completes", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (url) => {
      calls += 1;
      if (String(url).endsWith("/run")) {
        return new Response(JSON.stringify({ status: "RUNNING", runId: "run_async" }), { status: 202 });
      }
      return new Response(JSON.stringify({
        status: "COMPLETED",
        runId: "run_async",
        providerResponse: { httpStatus: 200 },
        output: [{ title: "Async result", url: "https://example.com/async" }],
      }));
    }) as typeof fetch;
    try {
      const results = await createTinyFishSearchProvider("secret").search({ query: "AI", maxResults: 1, timeoutMs: 1_000 });
      assert.equal(results[0]?.url, "https://example.com/async");
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = original;
    }
  });
});
