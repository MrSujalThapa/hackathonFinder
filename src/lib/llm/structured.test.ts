import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LlmError } from "@/lib/llm/errors";
import { createFakeLlmProvider } from "@/lib/llm/providers/fake";
import {
  extractJsonObject,
  generateJson,
  jsonSchemaResponseFormat,
} from "@/lib/llm/structured";

describe("structured LLM helpers", () => {
  it("parses plain and fenced JSON", () => {
    assert.deepEqual(extractJsonObject('{"ok":true}'), { ok: true });
    assert.deepEqual(extractJsonObject('```json\n{"ok":true}\n```'), {
      ok: true,
    });
  });

  it("throws a safe malformed error when JSON is absent", () => {
    assert.throws(
      () => extractJsonObject("not json"),
      (error: unknown) =>
        error instanceof LlmError && error.category === "malformed",
    );
  });

  it("generates JSON through any provider", async () => {
    const provider = createFakeLlmProvider();
    const { value } = await generateJson<{ ok: boolean }>(provider, {
      messages: [{ role: "user", content: "json please" }],
    });
    assert.deepEqual(value, { ok: true });
  });

  it("builds strict JSON schema response formats", () => {
    const format = jsonSchemaResponseFormat({
      name: "decision",
      schema: {
        type: "object",
        properties: { approve: { type: "boolean" } },
        required: ["approve"],
        additionalProperties: false,
      },
    });
    assert.equal(format.type, "json_schema");
    assert.equal(format.strict, true);
  });
});
