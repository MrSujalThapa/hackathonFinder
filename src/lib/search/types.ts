export type SearchRequest = {
  query: string;
  maxResults: number;
  dateFrom?: string;
  dateTo?: string;
  timeoutMs?: number;
};

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  /** Result domain / provider-reported source */
  source: string;
  metadata?: Record<string, unknown>;
};

export interface SearchProvider {
  readonly name: string;
  search(input: SearchRequest): Promise<SearchResult[]>;
}

export type SearchProviderName = "tavily" | "brave" | "exa" | "serpapi" | "mock";

export class MissingSearchConfigError extends Error {
  constructor(message = "SEARCH_PROVIDER and SEARCH_API_KEY are required for web search") {
    super(message);
    this.name = "MissingSearchConfigError";
  }
}

export class SearchProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SearchProviderError";
  }
}
