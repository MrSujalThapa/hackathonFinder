import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planDiscoveryWithLlm } from "@/agent/llm/planWithLlm";
import type { DiscoveryPreferences } from "@/core/discovery/types";
import type { LlmGenerateResult, LlmProvider } from "@/lib/llm/types";

function preferences(): DiscoveryPreferences {
  return {
    rawCommand: "find upcoming AI hackathons in Canada or remote",
    locations: ["Canada", "Remote"],
    themes: ["AI"],
    modes: ["online", "in-person", "hybrid"],
    sources: ["hacklist", "mlh", "web", "luma", "hakku"],
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
      async generate(): Promise<LlmGenerateResult> {
        calls += 1;
        return {
          provider: "mock",
          model: "mock",
          finishReason: "stop",
          text: JSON.stringify({
            selectedSources: ["web", "x", "mlh"],
            sourceIntents: [
              {
                source: "web",
                enabled: true,
                query: "AI hackathon Canada deadline",
                reason: "General web search can find current pages.",
              },
              {
                source: "mlh",
                enabled: true,
                reason: "MLH is a public hackathon index.",
              },
            ],
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
    assert.deepEqual(result.plan.selectedSources, ["web", "mlh", "hacklist", "luma", "hakku"]);
    assert.deepEqual(result.preferences.sources, ["web", "mlh", "hacklist", "luma", "hakku"]);
    assert.ok(
      result.plan.warnings.some((warning) =>
        /Planner omitted effective source luma/i.test(warning),
      ),
    );
    assert.ok(result.plan.sourceIntents.some((intent) => intent.source === "luma"));
    assert.ok(result.plan.sourceIntents.some((intent) => intent.source === "hakku"));
    assert.equal(result.usage?.totalTokens, 30);
  });

  it("accepts explicit luma and hakku source intents from the planner schema", async () => {
    const provider: LlmProvider = {
      name: "mock",
      async generate(): Promise<LlmGenerateResult> {
        return {
          provider: "mock",
          model: "mock",
          finishReason: "stop",
          text: JSON.stringify({
            selectedSources: ["luma", "hakku", "web", "mlh", "hacklist"],
            sourceIntents: [
              {
                source: "luma",
                enabled: true,
                query: "upcoming public hackathons Toronto",
                reason: "Luma public mode may contain local events.",
              },
              {
                source: "hakku",
                enabled: true,
                query: "upcoming hackathons in Toronto",
                reason: "Authenticated Hakku directory may contain local events.",
              },
              { source: "web", enabled: true, reason: "Search supplements source coverage." },
              { source: "mlh", enabled: true, reason: "MLH public collector." },
              { source: "hacklist", enabled: true, reason: "HackList native collector." },
            ],
            searchQueries: [],
            verificationGoals: [],
            needsEnrichment: true,
            stopReason: "planner complete",
            warnings: [],
          }),
        };
      },
    };

    const result = await planDiscoveryWithLlm(preferences(), { provider });
    assert.ok(result.preferences.sources.includes("luma"));
    assert.ok(result.preferences.sources.includes("hakku"));
    assert.ok(!result.preferences.sources.includes("x"));
  });
});
