export type LlmErrorCategory =
  | "missing_env"
  | "unsupported_provider"
  | "auth"
  | "rate_quota"
  | "timeout"
  | "network"
  | "bad_request"
  | "content_filter"
  | "malformed"
  | "server"
  | "unknown";

export class LlmError extends Error {
  readonly category: LlmErrorCategory;
  readonly provider?: string;
  readonly status?: number;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(
    category: LlmErrorCategory,
    message: string,
    options: {
      cause?: unknown;
      provider?: string;
      status?: number;
      retryable?: boolean;
    } = {},
  ) {
    super(redactLlmSecrets(message));
    this.name = "LlmError";
    this.category = category;
    this.provider = options.provider;
    this.status = options.status;
    this.retryable = options.retryable ?? isRetryableCategory(category);
    this.cause = options.cause;
  }
}

export class MissingLlmConfigError extends LlmError {
  constructor(
    message = "LLM_PROVIDER and LLM_API_KEY are required for live LLM calls",
  ) {
    super("missing_env", message, { retryable: false });
    this.name = "MissingLlmConfigError";
  }
}

export function redactLlmSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/Authorization:\s*[^\r\n]+/gi, "Authorization: [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]")
    .replace(/\bOPENAI_API_KEY=([^\s]+)/gi, "OPENAI_API_KEY=[REDACTED]")
    .replace(/\bLLM_API_KEY=([^\s]+)/gi, "LLM_API_KEY=[REDACTED]");
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  return name === "AbortError" || name === "TimeoutError";
}

export function classifyHttpStatus(status: number): LlmErrorCategory {
  if (status === 401 || status === 403) return "auth";
  if (status === 402 || status === 413 || status === 429) return "rate_quota";
  if (status >= 400 && status < 500) return "bad_request";
  if (status >= 500) return "server";
  return "unknown";
}

export function classifyMessageText(text: string): LlmErrorCategory | null {
  const lower = text.toLowerCase();
  if (
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("invalid api key") ||
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
    lower.includes("content filter") ||
    lower.includes("content policy") ||
    lower.includes("safety")
  ) {
    return "content_filter";
  }
  return null;
}

export function isRetryableCategory(category: LlmErrorCategory): boolean {
  return category === "timeout" || category === "network" || category === "server";
}
