import { LlmError } from "@/lib/llm/errors";
import type { LlmGenerateRequest, LlmGenerateResult, LlmProvider } from "@/lib/llm/types";

type Options = { apiKey: string; baseUrl: string; model?: string; name: string; fetchImpl?: typeof fetch };

/** Small OpenAI chat-completions adapter for providers such as SPUR. */
export function createOpenAiCompatibleProvider(options: Options): LlmProvider {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    name: options.name,
    async generate(input: LlmGenerateRequest): Promise<LlmGenerateResult> {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST", signal: input.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify({ model: input.model ?? options.model ?? "hari", messages: input.messages, max_tokens: input.maxOutputTokens, temperature: input.temperature, response_format: input.responseFormat?.type === "json_object" ? { type: "json_object" } : undefined }),
      });
      const raw = await response.text();
      if (!response.ok) throw new LlmError("unknown", `${options.name} HTTP ${response.status}: ${raw.slice(0, 240)}`, { provider: options.name, status: response.status });
      let data: { id?: string; model?: string; choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
      try { data = JSON.parse(raw) as typeof data; } catch { throw new LlmError("malformed", `${options.name} response was not JSON`, { provider: options.name, status: response.status }); }
      const choice = data.choices?.[0];
      return { provider: options.name, model: data.model ?? input.model ?? options.model ?? "hari", text: choice?.message?.content ?? "", finishReason: choice?.finish_reason === "length" ? "length" : "stop", usage: data.usage ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens, totalTokens: data.usage.total_tokens } : undefined, responseId: data.id };
    },
  };
}
