import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { FakeLlmProvider } from "@/lib/llm/createProvider";

test("fake provider returns deterministic structured output", async () => {
  const provider = new FakeLlmProvider([{ answer: "deadline unclear", confidence: "low" }]);
  const response = await provider.generateStructured({
    system: "test",
    prompt: "test",
    schemaName: "Answer",
    schema: z.object({ answer: z.string(), confidence: z.enum(["low", "medium", "high"]) }),
  });

  assert.equal(response.value.answer, "deadline unclear");
  assert.equal(response.diagnostics.provider, "mock");
  assert.equal(provider.calls, 1);
});
