import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ServerEnv } from "@/config/env";
import { readLlmConfig, requireLlmConfig } from "@/lib/llm/config";
import {
  createLlmProvider,
  createLlmProviderOptional,
  MissingLlmConfigError,
} from "@/lib/llm/createProvider";

function envPartial(overrides: Partial<ServerEnv>): ServerEnv {
  return {
    NODE_ENV: "test",
    USE_MOCK_CANDIDATES: false,
    ...overrides,
  } as ServerEnv;
}

describe("llm config", () => {
  it("returns null when provider is missing", () => {
    assert.equal(readLlmConfig(envPartial({})), null);
  });

  it("allows mock without an API key", () => {
    assert.deepEqual(
      readLlmConfig(envPartial({ LLM_PROVIDER: "mock", LLM_MODEL: "fake-a" })),
      { provider: "mock", model: "fake-a" },
    );
  });

  it("requires an API key for live providers", () => {
    assert.equal(readLlmConfig(envPartial({ LLM_PROVIDER: "openai" })), null);
    assert.throws(
      () => requireLlmConfig(envPartial({ LLM_PROVIDER: "openai" })),
      MissingLlmConfigError,
    );
  });
});

describe("createLlmProvider", () => {
  it("throws a clear error when unconfigured", () => {
    assert.throws(
      () => createLlmProvider({ env: envPartial({}), instrument: false }),
      /LLM_PROVIDER/,
    );
  });

  it("returns null from optional factory when unconfigured", () => {
    assert.equal(createLlmProviderOptional({ env: envPartial({}) }), null);
  });

  it("builds mock provider from env without network", async () => {
    const provider = createLlmProvider({
      env: envPartial({ LLM_PROVIDER: "mock" }),
      instrument: false,
    });
    const response = await provider.generate({
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(provider.name, "mock");
    assert.equal(response.text, "fake:hello");
  });

  it("keeps injected providers usable without env", async () => {
    const provider = createLlmProvider({
      instrument: false,
      provider: {
        name: "test-provider",
        async generate() {
          return {
            provider: "test-provider",
            model: "test-model",
            text: "ok",
            finishReason: "stop",
          };
        },
      },
    });
    const response = await provider.generate({ messages: [] });
    assert.equal(response.text, "ok");
  });
});
