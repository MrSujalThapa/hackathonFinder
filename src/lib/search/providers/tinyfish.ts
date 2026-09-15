import type { SearchProvider, SearchRequest, SearchResult } from "@/lib/search/types";
import { SearchProviderError } from "@/lib/search/types";
import { withSearchRetry } from "@/lib/search/provider";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "tinyfish";
  }
}

/**
 * TinyFish is accessed through Monid's run API. The endpoint is intentionally
 * normalized here so the rest of discovery only sees the SearchProvider contract.
 * Monid returns a run lifecycle wrapper; providerResponse is separate from a
 * successful Monid run and must therefore be checked independently.
 */
export function createTinyFishSearchProvider(apiKey: string): SearchProvider {
  return {
    name: "tinyfish",
    async search(input: SearchRequest): Promise<SearchResult[]> {
      return withSearchRetry(
        "tinyfish",
        async (signal) => {
          const response = await fetch("https://api.monid.ai/v1/run", {
            method: "POST",
            signal,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              provider: "tinyfish",
              endpoint: "/search",
              input: {
                query: input.query,
                maxResults: input.maxResults,
                ...(input.dateFrom ? { afterDate: input.dateFrom } : {}),
                ...(input.dateTo ? { beforeDate: input.dateTo } : {}),
                ...(input.location ? { location: input.location } : {}),
                language: "en",
                domainType: "web",
              },
            }),
          });
          if (!response.ok) {
            throw new SearchProviderError(
              `Monid HTTP ${response.status}${response.status === 429 ? " (rate limited)" : ""}`,
              "tinyfish",
            );
          }

          let data: UnknownRecord;
          try {
            data = record(await response.json()) ?? {};
          } catch (error) {
            throw new SearchProviderError("Monid returned malformed JSON", "tinyfish", error);
          }
          const status = stringValue(data.status);
          if (status && status !== "COMPLETED") {
            throw new SearchProviderError(`Monid run ${status.toLowerCase()}`, "tinyfish");
          }
          const providerResponse = record(data.providerResponse);
          const providerStatus = providerResponse && typeof providerResponse.httpStatus === "number"
            ? providerResponse.httpStatus
            : undefined;
          if (providerStatus && providerStatus >= 400) {
            throw new SearchProviderError(
              `TinyFish provider HTTP ${providerStatus}${providerStatus === 429 ? " (rate limited)" : ""}`,
              "tinyfish",
            );
          }
          const output = data.output;
          const rows = Array.isArray(output)
            ? output
            : Array.isArray(record(output)?.results)
              ? (record(output)!.results as unknown[])
              : [];
          const seen = new Set<string>();
          const results: SearchResult[] = [];
          for (const row of rows) {
            const item = record(row);
            if (!item) continue;
            const url = stringValue(item.url) ?? stringValue(item.link);
            const title = stringValue(item.title) ?? stringValue(item.name);
            if (!url || !title || seen.has(url)) continue;
            seen.add(url);
            results.push({
              title,
              url,
              snippet: stringValue(item.snippet) ?? stringValue(item.description) ?? stringValue(item.content) ?? "",
              publishedAt: stringValue(item.publishedAt) ?? stringValue(item.published_date) ?? stringValue(item.date),
              source: hostnameOf(url),
              metadata: { provider: "tinyfish", monidRunId: stringValue(data.runId) },
            });
            if (results.length >= input.maxResults) break;
          }
          return results;
        },
        { timeoutMs: input.timeoutMs ?? 10_000, retries: 1 },
      );
    },
  };
}
