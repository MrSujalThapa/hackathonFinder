import type { ServerEnv } from "@/config/env";
import { getServerEnv } from "@/config/env";
import { readLlmConfig, requireLlmConfig } from "@/lib/llm/config";
import { LlmError, MissingLlmConfigError } from "@/lib/llm/errors";
import {
  createInstrumentedLlmProvider,
  type WithLlmRetryOptions,
} from "@/lib/llm/provider";
import { createFakeLlmProvider } from "@/lib/llm/providers/fake";
import { createOpenAiLlmProvider } from "@/lib/llm/providers/openai";
import type { LlmProvider } from "@/lib/llm/types";

export type CreateLlmProviderOptions = WithLlmRetryOptions & {
  env?: ServerEnv;
  provider?: LlmProvider;
  instrument?: boolean;
};

function buildFromConfig(
  config: NonNullable<ReturnType<typeof readLlmConfig>>,
): LlmProvider {
  switch (config.provider) {
    case "mock":
      return createFakeLlmProvider({ model: config.model });
    case "openai":
      return createOpenAiLlmProvider({
        apiKey: config.apiKey!,
        model: config.model,
      });
    case "anthropic":
      throw new LlmError(
        "unsupported_provider",
        "LLM_PROVIDER=anthropic is recognized but not implemented yet",
        { provider: "anthropic", retryable: false },
      );
    default:
      throw new MissingLlmConfigError(
        `Unsupported LLM_PROVIDER: ${String(config.provider)}`,
      );
  }
}

export function createLlmProvider(
  options: CreateLlmProviderOptions = {},
): LlmProvider {
  if (options.provider) {
    return options.instrument === false
      ? options.provider
      : createInstrumentedLlmProvider(options.provider, options);
  }

  const env = options.env ?? getServerEnv();
  const config = requireLlmConfig(env);
  const provider = buildFromConfig(config);
  return options.instrument === false
    ? provider
    : createInstrumentedLlmProvider(provider, options);
}

export function createLlmProviderOptional(
  options: CreateLlmProviderOptions = {},
): LlmProvider | null {
  if (options.provider) {
    return createLlmProvider(options);
  }
  const env = options.env ?? getServerEnv();
  const config = readLlmConfig(env);
  if (!config) return null;
  return createLlmProvider({ ...options, env });
}

export { MissingLlmConfigError };
