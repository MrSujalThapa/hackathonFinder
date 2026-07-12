import { planSearchQueries } from "@/agent/planSearchQueries";
import type { RawLead } from "@/core/discovery/types";
import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";
import { classifyEventPage } from "@/core/classifyEventPage";
import {
  createSearchProviderOptional,
} from "@/lib/search/createSearchProvider";
import type { SearchProvider, SearchResult } from "@/lib/search/types";
import { MissingSearchConfigError } from "@/lib/search/types";
import { normalizeUrl, normalizeUrlForDedupe, slugify } from "@/lib/http/url";

const EVENT_VOCAB =
  /\b(hackathon|buildathon|codefest|hack\s*day|registration|apply|applications?\s+open|deadline|prize|devpost|mlh)\b/i;

const NOISE_VOCAB =
  /\b(what is a hackathon|history of hackathons|wikipedia|how to win|tips for|blog post|opinion)\b/i;

export type WebSearchCollectorDeps = {
  provider?: SearchProvider | null;
};

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

export function isPromisingSearchResult(result: SearchResult): boolean {
  const text = `${result.title} ${result.snippet} ${result.url}`;
  if (NOISE_VOCAB.test(text)) return false;

  const classified = classifyEventPage({
    name: result.title,
    title: result.title,
    url: result.url,
    description: result.snippet,
    text: result.snippet,
  });
  if (
    classified.classification === "EVENT_DIRECTORY" ||
    classified.classification === "ARTICLE" ||
    classified.classification === "ORGANIZATION_PAGE"
  ) {
    return false;
  }

  if (/(mlh\.io|mlh\.com|devpost\.com|lu\.ma|luma\.com|eventbrite\.com|unstop\.com)/i.test(result.url)) {
    return EVENT_VOCAB.test(text) || classified.classification === "INDIVIDUAL_EVENT";
  }
  if (/\.edu(\.|$)/i.test(result.url) && EVENT_VOCAB.test(text)) return true;
  return EVENT_VOCAB.test(text);
}


export function searchResultsToLeads(
  results: Array<SearchResult & { query?: string }>,
  maxResults: number,
): RawLead[] {
  const leads: RawLead[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    if (!isPromisingSearchResult(result)) continue;
    const url = normalizeUrl(result.url);
    if (!url) continue;
    const key = normalizeUrlForDedupe(url);
    if (seen.has(key)) continue;
    seen.add(key);

    leads.push({
      id: `web-${slugify(key)}`,
      source: "web",
      title: result.title,
      url,
      text: result.snippet,
      links: [url],
      postedAt: result.publishedAt ?? new Date().toISOString(),
      metadata: {
        query: result.query,
        snippet: result.snippet,
        domain: result.source || hostnameOf(url),
        publishedAt: result.publishedAt,
        officialUrl: url,
        sourceIds: { web: key },
        evidenceType: "search_result",
      },
    });

    if (leads.length >= maxResults) break;
  }

  return leads;
}

export function createWebSearchCollector(deps: WebSearchCollectorDeps = {}): Collector {
  return {
    source: "web",

    async collect(input: CollectorInput): Promise<CollectorResult> {
      const startedAt = Date.now();
      const result = emptyCollectorResult("web", startedAt);

      try {
        const provider =
          deps.provider === undefined
            ? createSearchProviderOptional({ instrument: true })
            : deps.provider;

        if (!provider) {
          result.warnings.push(
            "SEARCH_PROVIDER/SEARCH_API_KEY not configured; skipping web search.",
          );
          result.durationMs = Date.now() - startedAt;
          return result;
        }

        const queries = planSearchQueries(input.preferences);
        const combined: Array<SearchResult & { query: string }> = [];
        const perQueryBudget = Math.max(
          1_500,
          Math.floor(input.timeoutMs / Math.max(1, queries.length)),
        );

        for (const query of queries) {
          if (Date.now() - startedAt > input.timeoutMs) {
            result.warnings.push("Web search stopped early after timeout budget.");
            break;
          }

          try {
            const page = await provider.search({
              query,
              maxResults: Math.min(10, input.maxResults),
              dateFrom: input.preferences.dateFrom,
              dateTo: input.preferences.dateTo,
              timeoutMs: perQueryBudget,
            });
            for (const item of page) {
              combined.push({ ...item, query });
            }
          } catch (error) {
            if (error instanceof MissingSearchConfigError) {
              result.warnings.push(error.message);
              break;
            }
            result.warnings.push(
              error instanceof Error
                ? `Search query failed (${query}): ${error.message}`
                : `Search query failed (${query})`,
            );
          }
        }

        result.leads = searchResultsToLeads(combined, input.maxResults);
        if (result.leads.length === 0 && result.warnings.length === 0) {
          result.warnings.push("Web search returned no promising hackathon results.");
        }
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : "Web search failed");
      }

      result.durationMs = Date.now() - startedAt;
      return result;
    },
  };
}

export const webSearchCollector = createWebSearchCollector();
