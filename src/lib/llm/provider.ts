import { isAbortError, LlmError } from "@/lib/llm/errors";
import type {
  LlmGenerateRequest,
  LlmGenerateResult,
  LlmProvider,
} from "@/lib/llm/types";

export const DEFAULT_LLM_TIMEOUT_MS = 30_000;
export const DEFAULT_LLM_RETRIES = 2;
export const DEFAULT_MAX_OUTPUT_TOKENS = 800;

export type WithLlmRetryOptions = {
  retries?: number;
  timeoutMs?: number;
  maxOutputTokens?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

export function combineAbortSignals(
  timeoutMs: number,
  outerSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromOuter = () => controller.abort();

  if (outerSignal) {
    if (outerSignal.aborted) {
      controller.abort();
    } else {
      outerSignal.addEventListener("abort", abortFromOuter, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      outerSignal?.removeEventListener("abort", abortFromOuter);
    },
  };
}

export async function withLlmRetry(
  providerName: string,
  run: (signal: AbortSignal) => Promise<LlmGenerateResult>,
  options: WithLlmRetryOptions & { signal?: AbortSignal } = {},
): Promise<LlmGenerateResult> {
  const retries = options.retries ?? DEFAULT_LLM_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options.signal?.aborted) {
      throw new LlmError("timeout", "LLM request was aborted", {
        cause: abortError(),
        provider: providerName,
      });
    }

    const { signal, cleanup } = combineAbortSignals(timeoutMs, options.signal);
    try {
      return await run(signal);
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof LlmError
          ? error.retryable
          : isAbortError(error) || signal.aborted;
      if (attempt < retries && retryable && !options.signal?.aborted) {
        await sleep(200 * (attempt + 1));
        continue;
      }
      break;
    } finally {
      cleanup();
    }
  }

  if (lastError instanceof LlmError) {
    throw lastError;
  }
  if (isAbortError(lastError)) {
    throw new LlmError(
      "timeout",
      `LLM request timed out after ${timeoutMs}ms`,
      { cause: lastError, provider: providerName },
    );
  }
  throw new LlmError(
    "unknown",
    lastError instanceof Error ? lastError.message : "LLM request failed",
    { cause: lastError, provider: providerName },
  );
}

export function createInstrumentedLlmProvider(
  provider: LlmProvider,
  options: WithLlmRetryOptions = {},
): LlmProvider {
  return {
    name: provider.name,
    async generate(input: LlmGenerateRequest): Promise<LlmGenerateResult> {
      const timeoutMs = input.timeoutMs ?? options.timeoutMs;
      return withLlmRetry(
        provider.name,
        (signal) =>
          provider.generate({
            ...input,
            signal,
            maxOutputTokens:
              input.maxOutputTokens ??
              options.maxOutputTokens ??
              DEFAULT_MAX_OUTPUT_TOKENS,
            timeoutMs,
          }),
        {
          retries: options.retries,
          timeoutMs,
          signal: input.signal,
        },
      );
    },
  };
}
