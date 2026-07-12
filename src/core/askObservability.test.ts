import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAskObservabilityMeta } from "@/core/askObservability";

describe("buildAskObservabilityMeta", () => {
  it("keeps only safe fields", () => {
    const meta = buildAskObservabilityMeta({
      questionType: "decision",
      llmAttempted: true,
      llmSucceeded: false,
      fallbackUsed: true,
      model: "gpt-4o-mini",
      latencyMs: 123.4,
      researchCalls: 0,
    });
    assert.deepEqual(Object.keys(meta).sort(), [
      "fallbackUsed",
      "latencyMs",
      "llmAttempted",
      "llmSucceeded",
      "model",
      "questionType",
      "researchCalls",
    ]);
    assert.equal(meta.latencyMs, 123);
    assert.equal(meta.model, "gpt-4o-mini");
  });
});
