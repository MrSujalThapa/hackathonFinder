/**
 * X MCP configuration (app-only Bearer).
 * Reads process.env directly — do not require CLIENT_ID / CLIENT_SECRET.
 *
 * Security: never log the bearer token. Use getXBearerToken() only when
 * constructing Authorization headers; prefer describeXMcpConfig() for logs.
 */

export type XMcpMode = "app-only";

export type XMcpConfig = {
  mode: XMcpMode;
  url: string;
  maxQueriesPerRun: number;
  maxPostsPerQuery: number;
  totalPostLimit: number;
  requestTimeoutMs: number;
};

const DEFAULTS = {
  mode: "app-only" as const,
  url: "https://api.x.com/mcp",
  maxQueriesPerRun: 6,
  maxPostsPerQuery: 20,
  totalPostLimit: 60,
  requestTimeoutMs: 15_000,
};

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

/** True when a bearer token is present (URL defaults if unset). */
export function isXConfigured(): boolean {
  return Boolean(readEnv("X_BEARER_TOKEN"));
}

/**
 * Returns the bearer token for Authorization headers.
 * Do NOT log, stringify, or include in error messages.
 */
export function getXBearerToken(): string | undefined {
  return readEnv("X_BEARER_TOKEN");
}

export function getXMcpConfig(): XMcpConfig {
  const modeRaw = readEnv("X_MCP_MODE") ?? DEFAULTS.mode;
  const mode: XMcpMode =
    modeRaw === "app-only" ? "app-only" : "app-only";

  return {
    mode,
    url: readEnv("X_MCP_URL") ?? DEFAULTS.url,
    maxQueriesPerRun: parsePositiveInt(
      readEnv("X_MAX_QUERIES_PER_RUN"),
      DEFAULTS.maxQueriesPerRun,
    ),
    maxPostsPerQuery: parsePositiveInt(
      readEnv("X_MAX_POSTS_PER_QUERY"),
      DEFAULTS.maxPostsPerQuery,
    ),
    totalPostLimit: parsePositiveInt(
      readEnv("X_TOTAL_POST_LIMIT"),
      DEFAULTS.totalPostLimit,
    ),
    requestTimeoutMs: parsePositiveInt(
      readEnv("X_REQUEST_TIMEOUT_MS"),
      DEFAULTS.requestTimeoutMs,
    ),
  };
}

/** Safe summary for logs — never includes the bearer token. */
export function describeXMcpConfig(): string {
  if (!isXConfigured()) return "unconfigured";
  const config = getXMcpConfig();
  return [
    `mode=${config.mode}`,
    `url=${config.url}`,
    `maxQueries=${config.maxQueriesPerRun}`,
    `maxPosts=${config.maxPostsPerQuery}`,
    `totalLimit=${config.totalPostLimit}`,
    `timeoutMs=${config.requestTimeoutMs}`,
    "token=set",
  ].join(" ");
}

export function requireXMcpConfig(): XMcpConfig & { bearerToken: string } {
  const token = getXBearerToken();
  if (!token) {
    throw new Error(
      "X MCP is not configured. Set X_BEARER_TOKEN (and optionally X_MCP_URL).",
    );
  }
  return { ...getXMcpConfig(), bearerToken: token };
}
