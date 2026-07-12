import { getServerEnv, type ServerEnv } from "@/config/env";
import { MissingLlmConfigError } from "@/lib/llm/errors";
import type { LlmProviderName } from "@/lib/llm/types";

export type LlmConfig = {
  provider: LlmProviderName;
  apiKey?: string;
  model?: string;
};

export function readLlmConfig(env: ServerEnv = getServerEnv()): LlmConfig | null {
  if (!env.LLM_PROVIDER) return null;
  if (env.LLM_PROVIDER === "mock") {
    return { provider: "mock", model: env.LLM_MODEL?.trim() || undefined };
  }
  if (!env.LLM_API_KEY?.trim()) return null;
  return {
    provider: env.LLM_PROVIDER,
    apiKey: env.LLM_API_KEY.trim(),
    model: env.LLM_MODEL?.trim() || undefined,
  };
}

export function requireLlmConfig(env: ServerEnv = getServerEnv()): LlmConfig {
  const config = readLlmConfig(env);
  if (!config) {
    throw new MissingLlmConfigError(
      "LLM is not configured. Set LLM_PROVIDER (openai|anthropic|mock), LLM_API_KEY (not required for mock), and optionally LLM_MODEL.",
    );
  }
  return config;
}

export function describeLlmConfig(env: ServerEnv = getServerEnv()): string {
  const config = readLlmConfig(env);
  if (!config) return "unconfigured";
  return config.model ? `${config.provider}:${config.model}` : config.provider;
}
