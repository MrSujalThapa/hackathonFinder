import type { SearchProvider, SearchRequest, SearchResult } from "@/lib/search/types";

export type MockSearchProviderOptions = {
  results?: SearchResult[];
  handler?: (input: SearchRequest) => Promise<SearchResult[]> | SearchResult[];
};

export function createMockSearchProvider(
  options: MockSearchProviderOptions = {},
): SearchProvider {
  return {
    name: "mock",
    async search(input: SearchRequest): Promise<SearchResult[]> {
      if (options.handler) {
        return options.handler(input);
      }
      const results = options.results ?? [];
      return results.slice(0, input.maxResults).map((result) => ({
        ...result,
        metadata: {
          ...result.metadata,
          query: input.query,
        },
      }));
    },
  };
}
