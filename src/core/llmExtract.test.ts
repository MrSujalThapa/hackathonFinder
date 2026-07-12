import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RawLead } from "@/core/discovery/types";
import {
  extractGroundedHackathonEvent,
  type LlmExtractionProvider,
} from "@/core/llmExtract";

const lead: RawLead = {
  id: "lead-1",
  source: "web",
  title: "HackTO AI Challenge 2026",
  url: "https://hackto.example/events/ai-2026",
  text: "HackTO AI Challenge runs in Toronto. Apply by 2026-08-01 at https://hackto.example/apply.",
  links: ["https://hackto.example/apply"],
  postedAt: "2026-07-01T00:00:00Z",
  metadata: {
    city: "Toronto",
    country: "Canada",
    officialUrl: "https://hackto.example/events/ai-2026",
    applyUrl: "https://hackto.example/apply",
    themes: ["AI"],
  },
};

describe("extractGroundedHackathonEvent", () => {
  it("uses deterministic extraction and returns a stable cache key", async () => {
    const result = await extractGroundedHackathonEvent({ lead });
    const repeated = await extractGroundedHackathonEvent({ lead });

    assert.equal(result.event.name, "HackTO AI Challenge 2026");
    assert.equal(result.event.applyUrl, "https://hackto.example/apply");
    assert.ok(result.groundedFields.some((field) => field.field === "deadline" && field.value === "2026-08-01"));
    assert.equal(result.cacheKey, repeated.cacheKey);
  });

  it("filters provider fields that are not grounded in supplied evidence", async () => {
    const provider: LlmExtractionProvider = {
      name: "fake",
      async extract() {
        return {
          citations: [
            {
              field: "city",
              value: "Toronto",
              quote: "runs in Toronto",
              confidence: "high",
            },
            {
              field: "prize",
              value: "$1M NASA prize",
              quote: "runs in Toronto",
              confidence: "high",
            },
          ],
        };
      },
    };

    const result = await extractGroundedHackathonEvent({ lead, provider });

    assert.equal(result.event.city, "Toronto");
    assert.equal(result.event.prize, undefined);
    assert.deepEqual(result.unsupportedFields.map((field) => field.field), ["prize"]);
  });
});
