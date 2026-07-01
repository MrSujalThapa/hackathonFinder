import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  discoveryPreferencesSchema,
  hackathonEventSchema,
  rawLeadSchema,
  scoringResultSchema,
  verificationResultSchema,
} from "./schemas";

describe("discovery schemas", () => {
  it("validates a raw lead", () => {
    const parsed = rawLeadSchema.parse({
      id: "lead-1",
      source: "mock",
      title: "HackTO",
      links: ["https://example.com"],
      postedAt: "2026-07-01T00:00:00Z",
    });
    assert.equal(parsed.source, "mock");
  });

  it("validates discovery preferences", () => {
    const parsed = discoveryPreferencesSchema.parse({
      rawCommand: "find upcoming hackathons",
      locations: ["Toronto"],
      themes: ["AI"],
      modes: ["online"],
      sources: ["mock"],
      includeRemote: true,
      includeInPerson: true,
      maxResults: 25,
    });
    assert.equal(parsed.maxResults, 25);
  });

  it("validates hackathon event and scoring result", () => {
    hackathonEventSchema.parse({
      name: "HackTO",
      source: "mock",
      themes: ["AI"],
      evidence: [],
    });

    scoringResultSchema.parse({
      score: 80,
      whyMatch: ["Toronto match"],
      redFlags: [],
      rejected: false,
    });

    verificationResultSchema.parse({
      valid: true,
      confidence: "high",
      status: "accepted",
      reasons: ["Has official URL"],
      redFlags: [],
    });
  });
});
