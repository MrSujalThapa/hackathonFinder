import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  answerCandidateQuestion,
  suggestedCandidateQuestions,
} from "@/core/candidateQuestionAnswer";
import type { CandidateDetail } from "@/core/candidates/types";

function detail(overrides: Partial<CandidateDetail> = {}): CandidateDetail {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    status: "NEW",
    score: 80,
    name: "AI Hack",
    summary: "Build agent tools over a weekend.",
    source: "mlh",
    officialUrl: "https://example.com",
    applyUrl: "https://example.com/apply",
    socialUrl: null,
    startDate: "2026-08-01",
    endDate: null,
    deadline: "2026-07-25",
    location: "Online",
    mode: "online",
    city: "Remote",
    country: "Online",
    prize: "$5,000",
    themes: ["AI", "agents"],
    eligibility: "Open to students in Canada",
    whyMatch: ["Remote/online event"],
    redFlags: [],
    foundAt: "2026-07-01T00:00:00Z",
    lastVerified: "2026-07-01T00:00:00Z",
    approvedAt: null,
    sheetRowId: null,
    sheetAppendedAt: null,
    description: "Participants build AI agent prototypes.",
    fingerprint: "official:https://example.com",
    sourceIds: {},
    evidence: [
      {
        id: "e1",
        candidateId: "11111111-1111-4111-8111-111111111111",
        type: "official_page",
        url: "https://example.com",
        title: "Official",
        snippet: "Teams of 1-4. Judging on impact and demo quality.",
        raw: {},
        foundAt: "2026-07-01T00:00:00Z",
      },
    ],
    answers: [],
    actions: [],
    ...overrides,
  };
}

describe("answerCandidateQuestion", () => {
  it("answers arbitrary eligibility and team questions from stored facts", async () => {
    const eligibility = await answerCandidateQuestion(
      detail(),
      "Am I eligible as a Waterloo student?",
    );
    assert.match(eligibility.answer, /Eligibility|student/i);
    assert.ok(eligibility.sources.length > 0);

    const teams = await answerCandidateQuestion(detail(), "Are teams required?");
    assert.match(teams.answer, /Teams of 1-4/i);
    assert.equal(teams.certainty, "inferred");
  });

  it("distinguishes unknown prizes when missing", async () => {
    const result = await answerCandidateQuestion(
      detail({ prize: null }),
      "What are the prizes?",
    );
    assert.equal(result.certainty, "unknown");
    assert.match(result.answer, /not verified/i);
  });

  it("never invents judging criteria", async () => {
    const result = await answerCandidateQuestion(
      detail({
        evidence: [
          {
            id: "e1",
            candidateId: "c",
            type: "official_page",
            url: "https://example.com",
            title: "Official",
            snippet: "Welcome to the event",
            raw: {},
            foundAt: "2026-07-01T00:00:00Z",
          },
        ],
      }),
      "What are the judging criteria?",
    );
    assert.equal(result.certainty, "unknown");
  });

  it("suggests questions from gaps", () => {
    const suggestions = suggestedCandidateQuestions(
      detail({ deadline: null, prize: null, eligibility: null }),
    );
    assert.ok(suggestions.some((q) => /deadline/i.test(q)));
    assert.ok(suggestions.some((q) => /prizes/i.test(q)));
  });
});
