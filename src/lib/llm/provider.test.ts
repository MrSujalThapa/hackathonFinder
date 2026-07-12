import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LlmError } from "@/lib/llm/errors";
import { createInstrumentedLlmProvider } from "@/lib/llm/provider";
import type { LlmProvider } from "@/lib/llm/types";

describe("createInstrumentedLlmProvider", () => {
  it("adds default bounded output tokens", async () => {
    let seenMaxOutputTokens: number | undefined;
    const provider: LlmProvider = {
      name: "fake",
      async generate(input) {
        seenMaxOutputTokens = input.maxOutputTokens;
        return {
          provider: "fake",
          model: "fake-model",
          text: "ok",
          finishReason: "stop",
        };
      },
    };

    const wrapped = createInstrumentedLlmProvider(provider, {
      maxOutputTokens: 123,
      retries: 0,
    });
    await wrapped.generate({ messages: [] });
    assert.equal(seenMaxOutputTokens, 123);
  });

  it("retries retryable provider errors", async () => {
    let calls = 0;
    const provider: LlmProvider = {
      name: "flaky",
      async generate() {
        calls += 1;
        if (calls === 1) {
          throw new LlmError("server", "temporary", { provider: "flaky" });
        }
        return {
          provider: "flaky",
          model: "fake-model",
          text: "ok",
          finishReason: "stop",
        };
      },
    };

    const wrapped = createInstrumentedLlmProvider(provider, { retries: 1 });
    const response = await wrapped.generate({ messages: [] });
    assert.equal(response.text, "ok");
    assert.equal(calls, 2);
  });

  it("classifies timeout and abort as safe LLM errors", async () => {
    const provider: LlmProvider = {
      name: "slow",
      async generate(input) {
        await new Promise((_resolve, reject) => {
          input.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
        throw new Error("unreachable");
      },
    };

    const wrapped = createInstrumentedLlmProvider(provider, {
      timeoutMs: 10,
      retries: 0,
    });
    await assert.rejects(
      () => wrapped.generate({ messages: [] }),
      (error: unknown) =>
        error instanceof LlmError && error.category === "timeout",
    );
  });
});
