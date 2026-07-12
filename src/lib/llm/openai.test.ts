import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LlmError } from "@/lib/llm/errors";
import { createOpenAiLlmProvider } from "@/lib/llm/providers/openai";

describe("OpenAI LLM provider", () => {
  it("posts to the Responses API with bounded output and schema format", async () => {
    let seenUrl = "";
    let seenAuth = "";
    let seenBody: Record<string, unknown> | undefined;
    const provider = createOpenAiLlmProvider({
      apiKey: "sk-test-secret",
      model: "gpt-test",
      fetchImpl: async (url, init) => {
        seenUrl = String(url);
        seenAuth = (init?.headers as Record<string, string>).Authorization;
        seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            id: "resp_1",
            status: "completed",
            model: "gpt-test",
            output_text: '{"ok":true}',
            usage: {
              input_tokens: 3,
              output_tokens: 4,
              total_tokens: 7,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    });

    const response = await provider.generate({
      messages: [{ role: "user", content: "classify" }],
      maxOutputTokens: 64,
      responseFormat: {
        type: "json_schema",
        name: "classification",
        schema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          additionalProperties: false,
        },
      },
    });

    assert.equal(seenUrl, "https://api.openai.com/v1/responses");
    assert.equal(seenAuth, "Bearer sk-test-secret");
    assert.equal(seenBody?.model, "gpt-test");
    assert.equal(seenBody?.max_output_tokens, 64);
    assert.deepEqual(
      (seenBody?.text as { format: Record<string, unknown> }).format,
      {
        type: "json_schema",
        name: "classification",
        strict: true,
        schema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          additionalProperties: false,
        },
      },
    );
    assert.equal(response.text, '{"ok":true}');
    assert.equal(response.usage?.totalTokens, 7);
  });

  it("extracts text from structured output arrays", async () => {
    const provider = createOpenAiLlmProvider({
      apiKey: "sk-test-secret",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            model: "gpt-test",
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: "hello" }],
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    });

    const response = await provider.generate({
      messages: [{ role: "user", content: "say hello" }],
    });
    assert.equal(response.text, "hello");
  });

  it("classifies HTTP errors and redacts API keys", async () => {
    const provider = createOpenAiLlmProvider({
      apiKey: "sk-test-secret",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: { message: "invalid api key sk-test-secret" },
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        ),
    });

    await assert.rejects(
      () => provider.generate({ messages: [{ role: "user", content: "hi" }] }),
      (error: unknown) =>
        error instanceof LlmError &&
        error.category === "auth" &&
        !error.message.includes("sk-test-secret"),
    );
  });
});
