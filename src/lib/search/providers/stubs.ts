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

export function createBraveSearchProvider(_apiKey: string): SearchProvider {
  return notImplemented("brave");
}

export function createExaSearchProvider(_apiKey: string): SearchProvider {
  return notImplemented("exa");
}

export function createSerpApiSearchProvider(_apiKey: string): SearchProvider {
  return notImplemented("serpapi");
}
