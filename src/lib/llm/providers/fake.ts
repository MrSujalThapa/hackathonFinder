import type {
  LlmGenerateRequest,
  LlmGenerateResult,
  LlmProvider,
} from "@/lib/llm/types";

export type FakeLlmProviderOptions = {
  model?: string;
  text?: string;
  handler?: (
    input: LlmGenerateRequest,
  ) => Promise<string | LlmGenerateResult> | string | LlmGenerateResult;
};

function deterministicText(input: LlmGenerateRequest): string {
  if (input.responseFormat?.type === "json_schema") {
    return JSON.stringify({ ok: true, schema: input.responseFormat.name });
  }
  if (input.responseFormat?.type === "json_object") {
    return JSON.stringify({ ok: true });
  }
  const lastUser = [...input.messages]
    .reverse()
    .find((message) => message.role === "user");
  return `fake:${lastUser?.content ?? ""}`;
}

export function createFakeLlmProvider(
  options: FakeLlmProviderOptions = {},
): LlmProvider {
  return {
    name: "mock",
    async generate(input: LlmGenerateRequest): Promise<LlmGenerateResult> {
      const model = input.model ?? options.model ?? "fake-llm";
      const output = options.handler
        ? await options.handler(input)
        : options.text ?? deterministicText(input);

      if (typeof output !== "string") {
        return {
          ...output,
          provider: output.provider || "mock",
          model: output.model || model,
        };
      }

      return {
        provider: "mock",
        model,
        text: output.slice(0, Math.max(input.maxOutputTokens ?? output.length, 0) * 8),
        finishReason: "stop",
        usage: {
          inputTokens: input.messages.reduce(
            (sum, message) => sum + Math.ceil(message.content.length / 4),
            0,
          ),
          outputTokens: Math.ceil(output.length / 4),
        },
      };
    },
  };
}
