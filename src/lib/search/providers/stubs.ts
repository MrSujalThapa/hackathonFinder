import type { SearchProvider } from "@/lib/search/types";
import { SearchProviderError } from "@/lib/search/types";

function notImplemented(name: string): SearchProvider {
  return {
    name,
    async search() {
      throw new SearchProviderError(
        `Search provider "${name}" is not implemented yet. Use tavily or mock.`,
        name,
      );
    },
  };
}

export function createBraveSearchProvider(apiKey: string): SearchProvider {
  void apiKey;
  return notImplemented("brave");
}

export function createExaSearchProvider(apiKey: string): SearchProvider {
  void apiKey;
  return notImplemented("exa");
}

export function createSerpApiSearchProvider(apiKey: string): SearchProvider {
  void apiKey;
  return notImplemented("serpapi");
}
