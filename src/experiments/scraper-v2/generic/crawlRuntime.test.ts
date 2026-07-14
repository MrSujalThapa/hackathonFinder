import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CrawleeRuntime, ExistingCustomRuntime } from "@/experiments/scraper-v2/generic/crawlRuntime";
import { inferDiscoveryBudget } from "@/experiments/scraper-v2/generic/budget";
import { RUNTIME_COMPARISON_SITES } from "@/experiments/scraper-v2/generic/runtimeComparisonSites";
import { runGenericStructuredExtraction } from "@/experiments/scraper-v2/generic/structuredExtraction";
import type { SourceExperiment } from "@/experiments/scraper-v2/generic/types";

type RouteHandler = (request: IncomingMessage, response: ServerResponse) => void;

const records = (prefix: string, count: number) =>
  Array.from({ length: count }, (_value, index) => ({
    id: `${prefix}-${index}`,
    title: `${prefix} Hackathon ${index}`,
    href: `/${prefix}-${index}`,
    starts_at: "2026-08-01",
    location: "Online",
    status: "open",
  }));

async function withFixtureServer<T>(handler: RouteHandler, task: (origin: string) => Promise<T>): Promise<T> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    return await task(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function experiment(origin: string, path = "/events"): SourceExperiment {
  return {
    inputUrl: `${origin}${path}`,
    allowedOrigins: [origin],
    maxRequests: 20,
    maxPages: 3,
    maxPayloadBytes: 500_000,
    browserAllowed: true,
    expectedContentCategory: "public_event_directory",
    expectedMinimumEventCount: 3,
  };
}

function nextData(payload: unknown): string {
  return `<!doctype html><html><head><title>Events</title></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script></body></html>`;
}

describe("phase 5.2 Crawlee runtime", () => {
  it("keeps adapter parity for static framework artifacts", async () => {
    await withFixtureServer(
      (_request, response) => {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(nextData({ props: { pageProps: { events: records("Static", 3) } } }));
      },
      async (origin) => {
        const source = experiment(origin);
        const custom = await runGenericStructuredExtraction(source, { runtime: new ExistingCustomRuntime() });
        const crawlee = await runGenericStructuredExtraction(source, { runtime: new CrawleeRuntime() });
        assert.equal(custom.quality.validEventLeads, 3);
        assert.equal(crawlee.quality.validEventLeads, 3);
        assert.equal(crawlee.acquisition.runtime, "crawlee");
        assert.equal(crawlee.persistenceDisabled, true);
      },
    );
  });

  it("executes Crawlee request queue pagination without source-specific selectors", async () => {
    await withFixtureServer(
      (request, response) => {
        const url = new URL(request.url ?? "/", "http://fixture.test");
        const page = Number(url.searchParams.get("page") ?? "1");
        response.writeHead(200, { "content-type": "text/html" });
        response.end(`
          <!doctype html><html><body>
            <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
              props: { pageProps: { events: records(`Page${page}`, 2), meta: { total_count: 4 } } },
            })}</script>
            ${page === 1 ? `<a rel="next" href="/events?page=2">Next</a>` : ""}
          </body></html>
        `);
      },
      async (origin) => {
        const result = await runGenericStructuredExtraction(
          { ...experiment(origin, "/events?page=1"), maxPages: 2 },
          { runtime: new CrawleeRuntime(), budget: inferDiscoveryBudget({ query: "quick 4 hackathons" }) },
        );
        assert.equal(result.acquisition.paginationExecuted, true);
        assert.equal(result.acquisition.pagesRequested, 2);
        assert.equal(result.acquisition.queueRequestsAdded, 2);
        assert.equal(result.quality.validEventLeads, 4);
      },
    );
  });

  it("escalates from HTTP to Crawlee Playwright when static artifacts are insufficient", async () => {
    await withFixtureServer(
      (_request, response) => {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(`
          <!doctype html><html><body>
            <main id="events"></main>
            <script>
              document.querySelector("#events").innerHTML = ${JSON.stringify(
                records("Rendered", 3)
                  .map((record) => `<article><a href="${record.href}">${record.title}</a><time>${record.starts_at}</time><span>${record.location}</span></article>`)
                  .join(""),
              )};
            </script>
          </body></html>
        `);
      },
      async (origin) => {
        const result = await runGenericStructuredExtraction(experiment(origin), { runtime: new CrawleeRuntime() });
        assert.equal(result.acquisition.browserEscalated, true);
        assert.ok(result.acquisition.browserPages >= 1);
        assert.ok(result.artifacts.some((artifact) => artifact.kind === "dom_snapshot"));
      },
    );
  });

  it("honors cancellation before Crawlee starts", async () => {
    await withFixtureServer(
      (_request, response) => {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(nextData({ events: records("Cancel", 3) }));
      },
      async (origin) => {
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(
          () => runGenericStructuredExtraction(experiment(origin), { runtime: new CrawleeRuntime(), signal: controller.signal }),
          /cancelled|aborted|abort/i,
        );
      },
    );
  });

  it("saves and reloads deep-profile runtime checkpoints", async () => {
    const root = await mkdtemp(join(tmpdir(), "scraper-v2-crawlee-checkpoints-"));
    try {
      await withFixtureServer(
        (_request, response) => {
          response.writeHead(200, { "content-type": "text/html" });
          response.end(nextData({ events: records("Checkpoint", 3) }));
        },
        async (origin) => {
          const budget = inferDiscoveryBudget({ query: "deep 500 hackathons" });
          const source = experiment(origin);
          const first = await runGenericStructuredExtraction(source, { runtime: new CrawleeRuntime(), budget, checkpointDir: root });
          const second = await runGenericStructuredExtraction(source, { runtime: new CrawleeRuntime(), budget, checkpointDir: root });
          assert.equal(first.acquisition.checkpointSaved, true);
          assert.equal(second.acquisition.checkpointLoaded, true);
        },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the Crawlee runtime experiment-only and generic", async () => {
    const runtimeSource = await readFile("src/experiments/scraper-v2/generic/crawlRuntime.ts", "utf8");
    assert.doesNotMatch(runtimeSource, /supabase|candidateRepository|persistCandidate|googleapis/i);
    assert.doesNotMatch(runtimeSource, /devpost|devfolio|mlh|dorahacks|garage48|eventbrite|taikai|unstop/i);
  });

  it("enforces the required live comparison matrix and held-outs", () => {
    const slugs = new Set(RUNTIME_COMPARISON_SITES.map((site) => site.slug));
    for (const required of [
      "devfolio",
      "devpost",
      "mlh",
      "hackathon-radar",
      "hackathon-map",
      "hack-club",
      "garage48",
      "unstop",
      "eventbrite",
      "taikai",
      "dorahacks",
      "hackathons-space",
      "eventornado",
    ]) {
      assert.equal(slugs.has(required), true, `${required} missing from runtime comparison matrix`);
    }
    assert.ok(RUNTIME_COMPARISON_SITES.filter((site) => site.heldOut).length >= 3);
  });
});
