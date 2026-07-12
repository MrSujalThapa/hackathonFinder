import {
  classifyHttpStatus,
  classifyMessageText,
  isAbortError,
  LlmError,
  redactLlmSecrets,
} from "@/lib/llm/errors";
import type {
  LlmFinishReason,
  LlmGenerateRequest,
  LlmGenerateResult,
  LlmMessage,
  LlmProvider,
  LlmResponseFormat,
  LlmUsage,
} from "@/lib/llm/types";

export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

type OpenAiProviderOptions = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxResponseBytes?: number;
};

type OpenAiOutputItem = {
  type?: string;
  content?: Array<{
    type?: string;
    text?: string;
  }>;
};

type OpenAiResponse = {
  id?: string;
  model?: string;
  output_text?: string;
  output?: OpenAiOutputItem[];
  status?: string;
  error?: {
    code?: string;
    message?: string;
  } | null;
  incomplete_details?: {
    reason?: string;
  } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

async function readBodyBounded(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new LlmError(
        "malformed",
        `OpenAI response exceeds max size (${declared} > ${maxBytes} bytes)`,
        { provider: "openai", status: response.status },
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
      throw new LlmError(
        "malformed",
        `OpenAI response exceeds max size (${total} > ${maxBytes} bytes)`,
        { provider: "openai", status: response.status },
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

function toOpenAiInput(messages: LlmMessage[]): Array<{
  role: LlmMessage["role"];
  content: string;
}> {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function toOpenAiTextFormat(
  responseFormat: LlmResponseFormat | undefined,
): Record<string, unknown> | undefined {
  if (!responseFormat || responseFormat.type === "text") return undefined;
  if (responseFormat.type === "json_object") {
    return { format: { type: "json_object" } };
  }
  return {
    format: {
      type: "json_schema",
      name: responseFormat.name,
      description: responseFormat.description,
      strict: responseFormat.strict ?? true,
      schema: responseFormat.schema,
    },
  };
}

function parseResponseJson(text: string, status: number): OpenAiResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new LlmError("malformed", "OpenAI response is not valid JSON", {
      cause: error,
      provider: "openai",
      status,
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LlmError("malformed", "OpenAI response is not a JSON object", {
      provider: "openai",
      status,
    });
  }
  return parsed as OpenAiResponse;
}

function extractOutputText(data: OpenAiResponse): string {
  if (typeof data.output_text === "string") return data.output_text;
  const parts: string[] = [];
  for (const item of data.output ?? []) {
    for (const content of item.content ?? []) {
      if (
        (content.type === "output_text" || content.type === "text") &&
        typeof content.text === "string"
      ) {
        parts.push(content.text);
      }
    }
  }
  return parts.join("");
}

function finishReason(data: OpenAiResponse): LlmFinishReason {
  const reason = data.incomplete_details?.reason;
  if (reason === "max_output_tokens") return "length";
  if (reason === "content_filter") return "content_filter";
  if (data.error) return "error";
  if (data.status === "completed" || !data.status) return "stop";
  return "unknown";
}

function usage(data: OpenAiResponse): LlmUsage | undefined {
  if (!data.usage) return undefined;
  return {
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
    totalTokens: data.usage.total_tokens,
  };
}

function throwForHttpError(status: number, bodyText: string): never {
  const parsed = (() => {
    try {
      return JSON.parse(bodyText) as { error?: { message?: string } };
    } catch {
      return null;
    }
  })();
  const message = parsed?.error?.message ?? bodyText;
  const category =
    classifyMessageText(message) ?? classifyHttpStatus(status);
  const snippet = redactLlmSecrets(message).slice(0, 240);
  throw new LlmError(
    category,
    `OpenAI HTTP ${status}${snippet ? `: ${snippet}` : ""}`,
    { provider: "openai", status },
  );
}

export function createOpenAiLlmProvider(
  options: OpenAiProviderOptions,
): LlmProvider {
  const baseUrl = (options.baseUrl ?? DEFAULT_OPENAI_BASE_URL).replace(/\/$/, "");
  const model = options.model ?? DEFAULT_OPENAI_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_OPENAI_MAX_RESPONSE_BYTES;

  return {
    name: "openai",
    async generate(input: LlmGenerateRequest): Promise<LlmGenerateResult> {
      const requestModel = input.model ?? model;
      const body: Record<string, unknown> = {
        model: requestModel,
        input: toOpenAiInput(input.messages),
        max_output_tokens: input.maxOutputTokens,
        temperature: input.temperature,
        top_p: input.topP,
        text: toOpenAiTextFormat(input.responseFormat),
        metadata: input.metadata,
        safety_identifier: input.safetyIdentifier,
        store: false,
      };
      for (const key of Object.keys(body)) {
        if (body[key] === undefined) delete body[key];
      }

      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/responses`, {
          method: "POST",
          signal: input.signal,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify(body),
        });
      } catch (error) {
        if (isAbortError(error) || input.signal?.aborted) {
          throw new LlmError("timeout", "OpenAI request timed out or was aborted", {
            cause: error,
            provider: "openai",
          });
        }
        throw new LlmError(
          "network",
          `OpenAI network error: ${redactLlmSecrets(
            error instanceof Error ? error.message : String(error),
          )}`,
          { cause: error, provider: "openai" },
        );
      }

      const responseHeaders = headersToObject(response.headers);
      const bodyText = await readBodyBounded(response, maxResponseBytes);
      if (!response.ok) {
        throwForHttpError(response.status, bodyText);
      }
      if (!responseHeaders["content-type"]?.toLowerCase().includes("json")) {
        throw new LlmError("malformed", "OpenAI response was not JSON", {
          provider: "openai",
          status: response.status,
        });
      }

      const data = parseResponseJson(bodyText, response.status);
      if (data.error) {
        const category = classifyMessageText(data.error.message ?? "") ?? "unknown";
        throw new LlmError(
          category,
          `OpenAI response error: ${data.error.message ?? data.error.code ?? "unknown"}`,
          { provider: "openai", status: response.status },
        );
      }

      const text = extractOutputText(data);
      return {
        provider: "openai",
        model: data.model ?? requestModel,
        text,
        finishReason: finishReason(data),
        usage: usage(data),
        responseId: data.id,
      };
    },
  };
}
