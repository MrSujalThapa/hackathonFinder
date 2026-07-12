import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HackathonEvent } from "@/core/discovery/types";
import {
  runVerificationLoop,
  type VerificationSearchEnrichTool,
} from "@/core/verificationLoop";

describe("runVerificationLoop", () => {
  it("uses an injected tool to fill supported missing facts within bounds", async () => {
    const event: HackathonEvent = {
      name: "Sparse Hackathon",
      source: "web",
      location: "Toronto",
      city: "Toronto",
      country: "Canada",
      themes: ["AI"],
      evidence: [],
    };
    const queries: string[] = [];
    const tool: VerificationSearchEnrichTool = {
      name: "fake-search",
      async search(input) {
        queries.push(input.query);
        return [
          {
            title: "Sparse Hackathon",
            url: "https://sparse.example",
            snippet: "Official Sparse Hackathon page. Apply at https://sparse.example/apply. Deadline 2026-08-01.",
            facts: {
              officialUrl: "https://sparse.example",
              applyUrl: "https://sparse.example/apply",
              deadline: "2026-08-01",
            },
          },
        ];
      },
    };

    const result = await runVerificationLoop(event, {
      tool,
      maxIterations: 1,
      maxQueriesPerIteration: 2,
      now: new Date("2026-07-12T00:00:00Z"),
    });

    assert.equal(queries.length, 2);
    assert.equal(result.iterations.length, 1);
    assert.equal(result.event.officialUrl, "https://sparse.example");
    assert.equal(result.event.applyUrl, "https://sparse.example/apply");
    assert.equal(result.event.deadline, "2026-08-01");
    assert.equal(result.verification.status, "accepted");
  });

  it("does not call tools when no search tool is injected", async () => {
    const event: HackathonEvent = {
      name: "Sparse Hackathon",
      source: "web",
      themes: [],
      evidence: [],
    };

    const result = await runVerificationLoop(event, { maxIterations: 2 });
    assert.equal(result.iterations.length, 0);
    assert.ok(result.missingFacts.length > 0);
  });
});
