import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HackathonEvent } from "@/core/discovery/types";
import {
  buildCandidateSummaryCacheKey,
  deterministicCandidateSummary,
  findUnsupportedSummaryTerms,
  generateCandidateSummary,
  type CandidateSummaryProvider,
} from "@/core/candidateSummary";

const event: HackathonEvent = {
  name: "HackTO AI Challenge",
  source: "web",
  officialUrl: "https://hackto.example",
  applyUrl: "https://hackto.example/apply",
  deadline: "2026-08-01",
  location: "Toronto, Canada",
  city: "Toronto",
  country: "Canada",
  themes: ["AI", "agents"],
  eligibility: "Open to students",
  evidence: [
    {
      type: "official_page",
      url: "https://hackto.example",
      title: "HackTO AI Challenge",
      snippet: "HackTO AI Challenge in Toronto. Open to students. Deadline 2026-08-01.",
    },
  ],
};

describe("candidate summaries", () => {
  it("creates deterministic fallback summaries and cache keys", () => {
    const summary = deterministicCandidateSummary(event);

    assert.ok(summary.includes("HackTO AI Challenge"));
    assert.ok(summary.includes("Toronto"));
    assert.equal(
      buildCandidateSummaryCacheKey(event),
      buildCandidateSummaryCacheKey({ ...event, evidence: [...event.evidence] }),
    );
  });

  it("accepts grounded provider summaries", async () => {
    const provider: CandidateSummaryProvider = {
      name: "fake",
      async summarize() {
        return "HackTO AI Challenge is a Toronto AI hackathon open to students with registration deadline 2026-08-01.";
      },
    };

    const result = await generateCandidateSummary(event, { provider });

    assert.equal(result.usedFallback, false);
    assert.equal(result.unsupportedTerms.length, 0);
  });

  it("falls back when provider summary introduces unsupported facts", async () => {
    const provider: CandidateSummaryProvider = {
      name: "fake",
      async summarize() {
        return "HackTO AI Challenge is backed by NASA with a million dollar prize.";
      },
    };

    const result = await generateCandidateSummary(event, { provider });

    assert.equal(result.usedFallback, true);
    assert.ok(result.unsupportedTerms.includes("nasa"));
    assert.deepEqual(findUnsupportedSummaryTerms("Toronto students build AI", event), []);
  });
});
