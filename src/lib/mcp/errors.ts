export type McpErrorCategory =
  | "auth"
  | "rate_quota"
  | "timeout"
  | "malformed"
  | "missing_tool"
  | "network"
  | "policy";

export class McpError extends Error {
  readonly category: McpErrorCategory;
  readonly status?: number;
  override readonly cause?: unknown;

  constructor(
    category: McpErrorCategory,
    message: string,
    options?: { cause?: unknown; status?: number },
  ) {
    super(redactSecrets(message));
    this.name = "McpError";
    this.category = category;
    this.status = options?.status;
    this.cause = options?.cause;
  }
}

/** Strip Bearer tokens and similar secrets from error/log text. */
export function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(
      /Authorization:\s*[^\r\n]+/gi,
      "Authorization: [REDACTED]",
    );
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  return name === "AbortError" || name === "TimeoutError";
}

export function classifyHttpStatus(status: number): McpErrorCategory | null {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_quota";
  if (status === 402 || status === 413) return "rate_quota";
  return null;
}

export function classifyMessageText(text: string): McpErrorCategory | null {
  const lower = text.toLowerCase();
  if (
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("invalid token") ||
    lower.includes("authentication")
  ) {
    return "auth";
  }
  if (
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("quota") ||
    lower.includes("credit")
  ) {
    return "rate_quota";
  }
  if (
    lower.includes("unknown tool") ||
    lower.includes("tool not found") ||
    lower.includes("missing tool") ||
    lower.includes("no such tool")
  ) {
    return "missing_tool";
  }
  return null;
}
