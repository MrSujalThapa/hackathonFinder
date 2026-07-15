export type LlmProviderName = "openai" | "anthropic" | "mock";

export type LlmMessageRole = "system" | "developer" | "user" | "assistant";

export type LlmContentPart =
  | { type: "text"; text: string }
  | {
      type: "image";
      imageBase64: string;
      mediaType: "image/png" | "image/jpeg" | "image/webp";
      detail?: "low" | "high" | "auto";
    };

export type LlmMessage = {
  role: LlmMessageRole;
  content: string | LlmContentPart[];
};

export type LlmJsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  description?: string;
  strict?: boolean;
};

export type LlmResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | ({ type: "json_schema" } & LlmJsonSchema);

export type LlmGenerateRequest = {
  messages: LlmMessage[];
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  responseFormat?: LlmResponseFormat;
  metadata?: Record<string, string>;
  safetyIdentifier?: string;
};

export type LlmUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type LlmFinishReason =
  | "stop"
  | "length"
  | "content_filter"
  | "tool_call"
  | "error"
  | "unknown";

export type LlmGenerateResult = {
  provider: string;
  model: string;
  text: string;
  finishReason: LlmFinishReason;
  usage?: LlmUsage;
  responseId?: string;
};

export interface LlmProvider {
  readonly name: string;
  generate(input: LlmGenerateRequest): Promise<LlmGenerateResult>;
}
