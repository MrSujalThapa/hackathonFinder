import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  answerCandidateQuestion,
  classifyCandidateQuestion,
  formatDecisionAnswer,
  suggestedCandidateQuestions,
} from "@/core/candidateQuestionAnswer";
import type { CandidateDetail } from "@/core/candidates/types";
import { createFakeLlmProvider } from "@/lib/llm/providers/fake";

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

describe("classifyCandidateQuestion", () => {
  it("routes factual questions without an allowlist", () => {
    assert.equal(
      classifyCandidateQuestion("What is the application deadline?"),
      "factual",
    );
    assert.equal(classifyCandidateQuestion("Are teams required?"), "factual");
    assert.equal(
      classifyCandidateQuestion("Am I eligible as a Waterloo student?"),
      "factual",
    );
  });

  it("routes decision / advisory questions", () => {
    assert.equal(
      classifyCandidateQuestion("Should I do this hackathon?"),
      "decision",
    );
    assert.equal(
      classifyCandidateQuestion("Is it worth my time for portfolio value?"),
      "decision",
    );
    assert.equal(
      classifyCandidateQuestion("What are the risks if I commit?"),
      "decision",
    );
  });
});

describe("answerCandidateQuestion", () => {
  it("answers arbitrary eligibility and team questions from stored facts", async () => {
    const eligibility = await answerCandidateQuestion(
      detail(),
      "Am I eligible as a Waterloo student?",
    );
    assert.equal(eligibility.kind, "factual");
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

  it("returns structured LLM recommendations for decision questions", async () => {
    const provider = createFakeLlmProvider({
      handler: () =>
        JSON.stringify({
          recommendation: "yes",
          headline: "Worth doing if you want agent practice.",
          reasons: [
            "Remote/online format matches flexible participation.",
            "Theme aligns with AI agent building.",
          ],
          concerns: ["Prize details are sparse beyond the headline amount."],
          missingInformation: ["Exact judging rubric weightings."],
          nextStep: "Confirm eligibility on the official page, then apply.",
          confidence: "medium",
          citations: [
            { url: "https://example.com", label: "Official event page" },
          ],
        }),
    });

    const result = await answerCandidateQuestion(
      detail(),
      "Should I do this hackathon?",
      { llmProvider: provider },
    );

    assert.equal(result.kind, "decision");
    assert.ok(result.decision);
    assert.equal(result.decision?.recommendation, "yes");
    assert.match(result.decision?.headline ?? "", /agent practice/i);
    assert.ok((result.decision?.reasons.length ?? 0) >= 1);
    assert.match(result.answer, /Recommendation: yes/i);
    assert.equal(
      formatDecisionAnswer(result.decision!).includes("Next step:"),
      true,
    );
  });

  it("does not invent a decision template when LLM is unavailable", async () => {
    const result = await answerCandidateQuestion(
      detail(),
      "Should I do this hackathon?",
      { llmProvider: null },
    );
    assert.equal(result.kind, "decision");
    assert.equal(result.decision, undefined);
    assert.match(result.answer, /LLM provider/i);
  });

  it("suggests questions from gaps", () => {
    const suggestions = suggestedCandidateQuestions(
      detail({ deadline: null, prize: null, eligibility: null }),
    );
    assert.ok(suggestions.some((q) => /deadline/i.test(q)));
    assert.ok(suggestions.some((q) => /prizes/i.test(q)));
  });
});
