import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planDiscoveryWithLlm } from "@/agent/llm/planWithLlm";
import type { DiscoveryPreferences } from "@/core/discovery/types";
import type { LlmGenerateRequest, LlmGenerateResult, LlmProvider } from "@/lib/llm/types";

function preferences(): DiscoveryPreferences {
  return {
    rawCommand: "find upcoming AI hackathons in Canada or remote",
    locations: ["Canada", "Remote"],
    themes: ["AI"],
    modes: ["online", "in-person", "hybrid"],
    sources: ["hacklist", "mlh", "web"],
    includeRemote: true,
    includeInPerson: true,
    maxResults: 25,
  };
}

describe("planDiscoveryWithLlm", () => {
  it("calls the planner once and intersects sources with explicit allowlist", async () => {
    let calls = 0;
    const provider: LlmProvider = {
      name: "mock",
      async generate(_input: LlmGenerateRequest): Promise<LlmGenerateResult> {
        calls += 1;
        return {
          provider: "mock",
          model: "mock",
          finishReason: "stop",
          text: JSON.stringify({
            selectedSources: ["web", "x", "mlh"],
            searchQueries: ["AI hackathon Canada deadline"],
            verificationGoals: ["verify actual event page"],
            needsEnrichment: true,
            stopReason: "planner complete",
            warnings: [],
          }),
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        };
      },
    };

    const result = await planDiscoveryWithLlm(preferences(), { provider });

    assert.equal(calls, 1);
    assert.equal(result.llmCalls, 1);
    assert.equal(result.planningCalls, 1);
    assert.equal(result.fallbackUsed, false);
    assert.deepEqual(result.plan.selectedSources, ["web", "mlh"]);
    assert.deepEqual(result.preferences.sources, ["web", "mlh"]);
    assert.equal(result.usage?.totalTokens, 30);
  });
});
