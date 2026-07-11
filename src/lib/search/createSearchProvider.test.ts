import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readSearchConfig, requireSearchConfig } from "@/lib/search/config";
import {
  createSearchProvider,
  createSearchProviderOptional,
  MissingSearchConfigError,
} from "@/lib/search/createSearchProvider";
import { createMockSearchProvider } from "@/lib/search/providers/mock";
import type { ServerEnv } from "@/config/env";

function envPartial(overrides: Partial<ServerEnv>): ServerEnv {
  return {
    NODE_ENV: "test",
    USE_MOCK_CANDIDATES: false,
    ...overrides,
  } as ServerEnv;
}

describe("search config", () => {
  it("returns null when provider missing", () => {
    assert.equal(readSearchConfig(envPartial({})), null);
  });

  it("allows mock without API key", () => {
    const config = readSearchConfig(envPartial({ SEARCH_PROVIDER: "mock" }));
    assert.deepEqual(config, { provider: "mock" });
  });

  it("requires API key for live providers", () => {
    assert.equal(readSearchConfig(envPartial({ SEARCH_PROVIDER: "tavily" })), null);
    assert.throws(
      () => requireSearchConfig(envPartial({ SEARCH_PROVIDER: "tavily" })),
      MissingSearchConfigError,
    );
  });
});

describe("createSearchProvider", () => {
  it("throws a clear error when unconfigured", () => {
    assert.throws(
      () => createSearchProvider({ env: envPartial({}), instrument: false }),
      /SEARCH_PROVIDER/,
    );
  });

  it("returns null from optional factory when unconfigured", () => {
    assert.equal(createSearchProviderOptional({ env: envPartial({}) }), null);
  });

  it("uses injectable mock provider without live calls", async () => {
    const provider = createMockSearchProvider({
      results: [
        {
          title: "Toronto Hackathon",
          url: "https://example.com/hack",
          snippet: "Apply now for the Toronto AI hackathon",
          source: "example.com",
        },
      ],
    });

    const created = createSearchProvider({ provider, instrument: false });
    const results = await created.search({ query: "hackathon Toronto", maxResults: 5 });
    assert.equal(results.length, 1);
    assert.equal(results[0]?.url, "https://example.com/hack");
  });

  it("builds mock provider from env without network", async () => {
    const provider = createSearchProvider({
      env: envPartial({ SEARCH_PROVIDER: "mock" }),
      instrument: false,
    });
    assert.equal(provider.name, "mock");
    const results = await provider.search({ query: "test", maxResults: 3 });
    assert.deepEqual(results, []);
  });
});
