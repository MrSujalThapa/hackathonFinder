import { LlmError } from "@/lib/llm/errors";
import type {
  LlmGenerateRequest,
  LlmGenerateResult,
  LlmJsonSchema,
  LlmProvider,
  LlmResponseFormat,
} from "@/lib/llm/types";

export function jsonSchemaResponseFormat(
  schema: LlmJsonSchema,
): LlmResponseFormat {
  return {
    type: "json_schema",
    strict: true,
    ...schema,
  };
}

export function jsonObjectResponseFormat(): LlmResponseFormat {
  return { type: "json_object" };
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new LlmError("malformed", "LLM response was empty");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        // Fall through to balanced object extraction.
      }
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // Fall through to the safe error below.
    }
  }

  throw new LlmError("malformed", "LLM response did not contain valid JSON");
}

export async function generateJson<T>(
  provider: LlmProvider,
  input: LlmGenerateRequest & { responseFormat?: LlmResponseFormat },
  validate?: (value: unknown) => T,
): Promise<{ value: T; response: LlmGenerateResult }> {
  const response = await provider.generate({
    ...input,
    responseFormat: input.responseFormat ?? jsonObjectResponseFormat(),
  });
  const parsed = extractJsonObject(response.text);
  return {
    value: validate ? validate(parsed) : (parsed as T),
    response,
  };
}
