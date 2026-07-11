const DEFAULT_USER_AGENT = "HackathonApprovalAgent/1.0 (+https://github.com/hackathon-finder)";

export type FetchHtmlOptions = {
  timeoutMs?: number;
  retries?: number;
  userAgent?: string;
  headers?: Record<string, string>;
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

export async function fetchHtml(url: string, options: FetchHtmlOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const retries = options.retries ?? 2;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html,application/xhtml+xml",
          ...options.headers,
        },
        redirect: "follow",
      });

      if (!response.ok) {
        throw new FetchHtmlError(
          `HTTP ${response.status} fetching ${url}`,
          url,
          response.status,
        );
      }

      return await response.text();
    } catch (error) {
      if (error instanceof FetchHtmlError) {
        lastError = error;
      } else if (error instanceof Error && error.name === "AbortError") {
        lastError = new FetchHtmlError(`Timed out after ${timeoutMs}ms fetching ${url}`, url);
      } else {
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
