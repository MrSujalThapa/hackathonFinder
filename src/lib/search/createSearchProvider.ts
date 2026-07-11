import type { ServerEnv } from "@/config/env";
import { getServerEnv } from "@/config/env";
import { readSearchConfig, requireSearchConfig } from "@/lib/search/config";
import { createInstrumentedProvider } from "@/lib/search/provider";
import { createMockSearchProvider } from "@/lib/search/providers/mock";
import {
  createBraveSearchProvider,
  createExaSearchProvider,
  createSerpApiSearchProvider,
} from "@/lib/search/providers/stubs";
import { createTavilySearchProvider } from "@/lib/search/providers/tavily";
import type { SearchProvider } from "@/lib/search/types";
import { MissingSearchConfigError } from "@/lib/search/types";

export type CreateSearchProviderOptions = {
  env?: ServerEnv;
  /** Inject a provider for tests (bypasses env). */
  provider?: SearchProvider;
  instrument?: boolean;
};

function buildFromConfig(config: NonNullable<ReturnType<typeof readSearchConfig>>): SearchProvider {
  switch (config.provider) {
    case "mock":
      return createMockSearchProvider();
    case "tavily":
      return createTavilySearchProvider(config.apiKey!);
    case "brave":
      return createBraveSearchProvider(config.apiKey!);
    case "exa":
      return createExaSearchProvider(config.apiKey!);
    case "serpapi":
      return createSerpApiSearchProvider(config.apiKey!);
    default:
      throw new MissingSearchConfigError(`Unsupported SEARCH_PROVIDER: ${String(config.provider)}`);
  }
}

/** Throws MissingSearchConfigError when SEARCH_* is not configured. */
export function createSearchProvider(options: CreateSearchProviderOptions = {}): SearchProvider {
  if (options.provider) {
    return options.instrument === false
      ? options.provider
      : createInstrumentedProvider(options.provider);
  }

  const env = options.env ?? getServerEnv();
  const config = requireSearchConfig(env);
  const provider = buildFromConfig(config);
  return options.instrument === false ? provider : createInstrumentedProvider(provider);
}

/** Returns null when search is not configured (web collector should warn). */
export function createSearchProviderOptional(
  options: CreateSearchProviderOptions = {},
): SearchProvider | null {
  if (options.provider) {
    return createSearchProvider(options);
  }
  const env = options.env ?? getServerEnv();
  const config = readSearchConfig(env);
  if (!config) return null;
  return createSearchProvider({ ...options, env });
}

export { MissingSearchConfigError };
