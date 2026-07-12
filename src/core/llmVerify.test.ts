import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HackathonEvent } from "@/core/discovery/types";
import {
  buildLlmVerificationCacheKey,
  synthesizeGroundedVerification,
  type LlmVerificationProvider,
} from "@/core/llmVerify";

const event: HackathonEvent = {
  name: "HackTO AI Challenge",
  source: "web",
  officialUrl: "https://hackto.example",
  applyUrl: "https://hackto.example/apply",
  deadline: "2026-08-01",
  location: "Toronto, Canada",
  city: "Toronto",
  country: "Canada",
  themes: ["AI"],
  evidence: [
    {
      type: "official_page",
      url: "https://hackto.example",
      title: "HackTO AI Challenge",
      snippet: "Official page. Registration closes 2026-08-01 in Toronto.",
    },
  ],
};

describe("synthesizeGroundedVerification", () => {
  it("falls back to deterministic verification without a provider", async () => {
    const result = await synthesizeGroundedVerification(event, {
      now: new Date("2026-07-12T00:00:00Z"),
    });

    assert.equal(result.status, "accepted");
    assert.equal(result.usedFallback, true);
    assert.equal(result.cacheKey, buildLlmVerificationCacheKey(event));
  });

  it("keeps only provider claims supported by event facts or evidence", async () => {
    const provider: LlmVerificationProvider = {
      name: "fake",
      async verify() {
        return {
          status: "accepted",
          confidence: "high",
          reasons: [
            { text: "Official page present", url: "https://hackto.example" },
            { text: "Backed by NASA", quote: "NASA grand prize" },
          ],
          redFlags: [{ text: "Toronto date unclear", quote: "Toronto" }],
        };
      },
    };

    const result = await synthesizeGroundedVerification(event, { provider });

    assert.equal(result.status, "accepted");
    assert.deepEqual(result.reasons, ["Official page present"]);
    assert.deepEqual(result.redFlags, ["Toronto date unclear"]);
    assert.deepEqual(result.unsupportedClaims, ["Backed by NASA"]);
    assert.equal(result.confidence, "medium");
  });
});
