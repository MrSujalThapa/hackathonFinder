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

// TinyFish's `location` query parameter is an ISO 3166-1 alpha-2 country
// code, rather than a free-form city or region. City and region intent stays
// in the query itself; only pass a location value when it is valid for the
// provider so an arbitrary request such as "Ottawa" cannot make the call fail.
function tinyFishCountryCode(location: string | undefined): string | undefined {
  if (!location) return undefined;
  const normalized = location.trim().toLowerCase();
  if (/^[a-z]{2}$/i.test(normalized)) return normalized.toUpperCase();
  const codes: Record<string, string> = {
    australia: "AU",
    brazil: "BR",
    canada: "CA",
    france: "FR",
    germany: "DE",
    india: "IN",
    ireland: "IE",
    italy: "IT",
    japan: "JP",
    mexico: "MX",
    netherlands: "NL",
    spain: "ES",
    "united kingdom": "GB",
    uk: "GB",
    "united states": "US",
    usa: "US",
    us: "US",
  };
  return codes[normalized];
}

async function parseMonidResponse(response: Response): Promise<UnknownRecord> {
  try {
    return record(await response.json()) ?? {};
  } catch (error) {
    throw new SearchProviderError("Monid returned malformed JSON", "tinyfish", error);
  }
}

async function waitForMonidRun(
  initial: UnknownRecord,
  apiKey: string,
  signal: AbortSignal,
): Promise<UnknownRecord> {
  let run = initial;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = stringValue(run.status);
    if (!status || status === "COMPLETED") return run;
    if (status === "FAILED" || status === "CANCELLED") {
      throw new SearchProviderError(`Monid run ${status.toLowerCase()}`, "tinyfish");
    }
    const runId = stringValue(run.runId);
    if (!runId) throw new SearchProviderError("Monid async run omitted runId", "tinyfish");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 100);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });
    const response = await fetch(`https://api.monid.ai/v1/runs/${encodeURIComponent(runId)}`, {
      signal,
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      throw new SearchProviderError(
        `Monid run HTTP ${response.status}${response.status === 429 ? " (rate limited)" : ""}`,
        "tinyfish",
      );
    }
    run = await parseMonidResponse(response);
  }
  throw new SearchProviderError("Monid run did not complete before timeout", "tinyfish");
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
          const seen = new Set<string>();
          const results: SearchResult[] = [];
          const countryCode = tinyFishCountryCode(input.location);
          // The TinyFish endpoint has zero-indexed pages from 0 through 10.
          for (let page = 0; results.length < input.maxResults && page <= 10; page += 1) {
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
                queryParams: {
                  query: input.query,
                  page,
                  ...(input.dateFrom ? { after_date: input.dateFrom } : {}),
                  ...(input.dateTo ? { before_date: input.dateTo } : {}),
                  ...(countryCode ? { location: countryCode } : {}),
                  language: "en",
                  domain_type: "web",
                },
              },
            }),
          });
          if (!response.ok) {
            throw new SearchProviderError(
              `Monid HTTP ${response.status}${response.status === 429 ? " (rate limited)" : ""}`,
              "tinyfish",
            );
          }

          let data = await parseMonidResponse(response);
          if (response.status === 202) data = await waitForMonidRun(data, apiKey, signal);
          const status = stringValue(data.status);
          if (!status) {
            throw new SearchProviderError("Monid response omitted run status", "tinyfish");
          }
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
          if (!("output" in data)) {
            throw new SearchProviderError("Monid completed run omitted output", "tinyfish");
          }
          const output = data.output;
          const rows = Array.isArray(output)
            ? output
            : Array.isArray(record(output)?.results)
              ? (record(output)!.results as unknown[])
              : [];
          let pageUnique = 0;
          for (const row of rows) {
            const item = record(row);
            if (!item) continue;
            const url = stringValue(item.url) ?? stringValue(item.link);
            const title = stringValue(item.title) ?? stringValue(item.name);
            if (!url || !title || seen.has(url)) continue;
            seen.add(url);
            pageUnique += 1;
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
          // An all-duplicate page means there is no useful next page; prevents
          // repeated provider pages from consuming the query budget.
          if (pageUnique === 0) break;
          }
          return results;
        },
        { timeoutMs: input.timeoutMs ?? 10_000, retries: 1 },
      );
    },
  };
}
