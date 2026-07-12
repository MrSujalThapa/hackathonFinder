const DEFAULT_USER_AGENT = "HackathonApprovalAgent/1.0 (+https://github.com/hackathon-finder)";

export type FetchHtmlOptions = {
  timeoutMs?: number;
  retries?: number;
  maxRedirects?: number;
  maxBytes?: number;
  userAgent?: string;
  headers?: Record<string, string>;
  validateUrl?: (url: string) => unknown | Promise<unknown>;
  fetchImpl?: typeof fetch;
};

export class FetchHtmlError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FetchHtmlError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readTextBounded(response: Response, maxBytes?: number): Promise<string> {
  if (!maxBytes) {
    return response.text();
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new FetchHtmlError(
        `Response too large (${declared} > ${maxBytes} bytes)`,
        response.url,
        response.status,
      );
    }
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new FetchHtmlError(
        `Response too large (${total} > ${maxBytes} bytes)`,
        response.url,
        response.status,
      );
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

export async function fetchHtml(url: string, options: FetchHtmlOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const retries = options.retries ?? 2;
  const maxRedirects = options.maxRedirects ?? 5;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const fetchImpl = options.fetchImpl ?? fetch;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let currentUrl = url;
      let response: Response;

      for (let redirects = 0; ; redirects += 1) {
        await options.validateUrl?.(currentUrl);
        response = await fetchImpl(currentUrl, {
          signal: controller.signal,
          headers: {
            "User-Agent": userAgent,
            Accept: "text/html,application/xhtml+xml",
            ...options.headers,
          },
          redirect: "manual",
        });

        if (response.status < 300 || response.status >= 400) break;

        const location = response.headers.get("location");
        if (!location) {
          throw new FetchHtmlError(`Redirect missing Location fetching ${currentUrl}`, currentUrl, response.status);
        }
        if (redirects >= maxRedirects) {
          throw new FetchHtmlError(`Too many redirects fetching ${url}`, currentUrl, response.status);
        }

        currentUrl = new URL(location, currentUrl).toString();
      }

      if (!response.ok) {
        throw new FetchHtmlError(
          `HTTP ${response.status} fetching ${currentUrl}`,
          currentUrl,
          response.status,
        );
      }

      return await readTextBounded(response, options.maxBytes);
    } catch (error) {
      if (error instanceof FetchHtmlError) {
        lastError = error;
      } else if (error instanceof Error && error.name === "AbortError") {
        lastError = new FetchHtmlError(`Timed out after ${timeoutMs}ms fetching ${url}`, url);
      } else {
        if (error instanceof Error && error.name === "UnsafeUrlError") {
          throw error;
        }
        lastError = new FetchHtmlError(
          error instanceof Error ? error.message : `Failed to fetch ${url}`,
          url,
        );
      }

      if (attempt < retries) {
        await sleep(250 * (attempt + 1));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new FetchHtmlError(`Failed to fetch ${url}`, url);
}
