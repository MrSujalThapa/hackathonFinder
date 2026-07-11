import type { SearchProvider, SearchRequest, SearchResult } from "@/lib/search/types";
import { SearchProviderError } from "@/lib/search/types";

export type WithSearchRetryOptions = {
  retries?: number;
  timeoutMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps a search function with timeout + bounded retries.
 * Never logs secrets; only surfaces provider name and safe error messages.
 */
export async function withSearchRetry(
  providerName: string,
  run: (signal: AbortSignal) => Promise<SearchResult[]>,
  options: WithSearchRetryOptions = {},
): Promise<SearchResult[]> {
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? 10_000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await run(controller.signal);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(200 * (attempt + 1));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  const message =
    lastError instanceof Error
      ? lastError.name === "AbortError"
        ? `Search timed out after ${timeoutMs}ms`
        : lastError.message
      : "Search request failed";

  throw new SearchProviderError(message, providerName, lastError);
}

export function createInstrumentedProvider(
  provider: SearchProvider,
  options: WithSearchRetryOptions = {},
): SearchProvider {
  return {
    name: provider.name,
    async search(input: SearchRequest): Promise<SearchResult[]> {
      return withSearchRetry(
        provider.name,
        async () => provider.search({ ...input, timeoutMs: input.timeoutMs ?? options.timeoutMs }),
        {
          retries: options.retries,
          timeoutMs: input.timeoutMs ?? options.timeoutMs,
        },
      );
    },
  };
}
