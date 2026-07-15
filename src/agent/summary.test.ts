import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAcceptedSummary } from "@/agent/summary";
import type { AcceptedCandidate } from "@/core/discovery/types";

describe("buildAcceptedSummary", () => {
  it("rejects contradictory application deadline state", () => {
    const candidate: AcceptedCandidate = {
      event: {
        name: "Hack the 6ix",
        source: "web",
        sourceIds: {},
        themes: ["AI"],
        applicationDeadline: "2026-06-20",
        evidence: [],
      },
      score: {
        score: 80,
        whyMatch: ["AI hackathon"],
        redFlags: [],
        rejected: false,
      },
      fingerprint: "test",
      status: "NEW",
      deadlineState: "missing",
    };

    assert.throws(
      () => buildAcceptedSummary([candidate]),
      /concrete application deadline with missing deadline state/i,
    );
  });
});
