import type { SearchProvider, SearchRequest, SearchResult } from "@/lib/search/types";
import { SearchProviderError } from "@/lib/search/types";
import { withSearchRetry } from "@/lib/search/provider";

type TavilyResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    published_date?: string;
  }>;
};

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

export function createTavilySearchProvider(apiKey: string): SearchProvider {
  return {
    name: "tavily",
    async search(input: SearchRequest): Promise<SearchResult[]> {
      return withSearchRetry(
        "tavily",
        async (signal) => {
          const response = await fetch("https://api.tavily.com/search", {
            method: "POST",
            signal,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              query: input.query,
              max_results: input.maxResults,
              include_answer: false,
              search_depth: "basic",
              ...(input.dateFrom || input.dateTo
                ? {
                    // Tavily may ignore unknown fields; keep for forward-compat.
                    start_date: input.dateFrom,
                    end_date: input.dateTo,
                  }
                : {}),
            }),
          });

          if (!response.ok) {
            throw new SearchProviderError(
              `Tavily HTTP ${response.status}`,
              "tavily",
            );
          }

          const data = (await response.json()) as TavilyResponse;
          return (data.results ?? [])
            .filter((row) => row.url && row.title)
            .slice(0, input.maxResults)
            .map((row) => ({
              title: row.title!.trim(),
              url: row.url!.trim(),
              snippet: (row.content ?? "").trim(),
              publishedAt: row.published_date,
              source: hostnameOf(row.url!),
              metadata: { provider: "tavily" },
            }));
        },
        { timeoutMs: input.timeoutMs ?? 10_000, retries: 1 },
      );
    },
  };
}
