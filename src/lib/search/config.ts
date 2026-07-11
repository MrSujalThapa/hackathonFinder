import { getServerEnv, type ServerEnv } from "@/config/env";
import type { SearchProviderName } from "@/lib/search/types";
import { MissingSearchConfigError } from "@/lib/search/types";

export type SearchConfig = {
  provider: SearchProviderName;
  apiKey?: string;
};

export function readSearchConfig(env: ServerEnv = getServerEnv()): SearchConfig | null {
  if (!env.SEARCH_PROVIDER) return null;
  if (env.SEARCH_PROVIDER === "mock") {
    return { provider: "mock" };
  }
  if (!env.SEARCH_API_KEY?.trim()) return null;
  return {
    provider: env.SEARCH_PROVIDER,
    apiKey: env.SEARCH_API_KEY.trim(),
  };
}

export function requireSearchConfig(env: ServerEnv = getServerEnv()): SearchConfig {
  const config = readSearchConfig(env);
  if (!config) {
    throw new MissingSearchConfigError(
      "Web search is not configured. Set SEARCH_PROVIDER (tavily|brave|exa|serpapi|mock) and SEARCH_API_KEY (not required for mock).",
    );
  }
  return config;
}

export function describeSearchConfig(env: ServerEnv = getServerEnv()): string {
  const config = readSearchConfig(env);
  if (!config) return "unconfigured";
  return config.provider;
}
