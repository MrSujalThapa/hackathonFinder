import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  answerCandidateQuestion,
  classifyCandidateQuestion,
  formatDecisionAnswer,
  reasonText,
  suggestedCandidateQuestions,
} from "@/core/candidateQuestionAnswer";
import {
  parseDecisionRecommendation,
  parseFactualAnswerPayload,
  readPersistedAskPayload,
} from "@/core/candidateAskDecision";
import type { CandidateDetail } from "@/core/candidates/types";
import { createFakeLlmProvider } from "@/lib/llm/providers/fake";
import { createMockSearchProvider } from "@/lib/search/providers/mock";

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
    endDate: "2026-08-03",
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
    assert.equal(classifyCandidateQuestion("date?"), "factual");
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
  it("answers date/when/schedule from stored start/end/deadline", async () => {
    const result = await answerCandidateQuestion(detail(), "date?", {
      searchProvider: createMockSearchProvider({
        results: [
          {
            title: "Random blog about dates",
            url: "https://spam.example/dates",
            snippet: "Unrelated SEO copy about calendars and holidays.",
            source: "mock",
          },
        ],
      }),
      maxSearchCalls: 1,
    });

    assert.equal(result.kind, "factual");
    assert.equal(result.certainty, "confirmed");
    assert.equal(result.confidence, "high");
    assert.match(result.answer, /2026-08-01/);
    assert.match(result.answer, /2026-08-03/);
    assert.match(result.answer, /2026-07-25/);
    assert.ok(!/Live search addendum/i.test(result.answer));
    assert.ok(!/Unrelated SEO/i.test(result.answer));
    assert.ok(result.factual);
    assert.ok(
      (result.factual?.supportingFacts ?? []).some((f) =>
        /startDate:\s*2026-08-01/.test(f),
      ),
    );
    assert.equal(result.meta?.researchCalls ?? 0, 0);
  });

  it("answers when/schedule without dumping summary blobs", async () => {
    const result = await answerCandidateQuestion(
      detail(),
      "When is the schedule?",
    );
    assert.equal(result.certainty, "confirmed");
    assert.ok(!/Relevant notes:/i.test(result.answer));
    assert.ok(!/Build agent tools/i.test(result.answer));
    assert.match(result.answer, /runs 2026-08-01 to 2026-08-03/i);
  });

  it("never appends Live search addendum on factual research fallback", async () => {
    const search = createMockSearchProvider({
      results: [
        {
          title: "Noise",
          url: "https://noise.example",
          snippet: "Pipe junk: foo | bar | baz",
          source: "mock",
        },
      ],
    });

    const result = await answerCandidateQuestion(
      detail({ prize: null }),
      "What are the prizes?",
      { searchProvider: search, llmProvider: null, maxSearchCalls: 1 },
    );

    assert.equal(result.kind, "factual");
    assert.ok(!/Live search addendum/i.test(result.answer));
    assert.ok(!/Pipe junk/i.test(result.answer));
    assert.equal(result.liveVerification, true);
    assert.ok(result.sources.some((s) => s.url === "https://noise.example"));
    assert.equal(result.meta?.fallbackUsed, true);
    assert.equal(result.meta?.researchCalls, 1);
  });

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
      { searchProvider: null },
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
      { searchProvider: null },
    );
    assert.equal(result.certainty, "unknown");
  });

  it("returns structured LLM recommendations for decision questions", async () => {
    const provider = createFakeLlmProvider({
      handler: () =>
        JSON.stringify({
          recommendation: "yes",
          headline: "Worth doing if you want agent practice.",
          summary:
            "A solid yes for remote AI-agent practice if you can meet the July deadline.",
          reasons: [
            {
              text: "Remote/online format matches flexible participation.",
              basis: "verified",
            },
            {
              text: "Theme aligns with AI agent building.",
              basis: "inferred",
            },
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
      {
        llmProvider: provider,
        searchProvider: createMockSearchProvider({
          results: [
            {
              title: "Should be ignored on decision path",
              url: "https://ignored.example",
              snippet: "SERP dump must not leak",
              source: "mock",
            },
          ],
        }),
        maxSearchCalls: 1,
      },
    );

    assert.equal(result.kind, "decision");
    assert.ok(result.decision);
    assert.equal(result.decision?.recommendation, "yes");
    assert.match(result.decision?.headline ?? "", /agent practice/i);
    assert.match(result.decision?.summary ?? "", /solid yes/i);
    assert.ok((result.decision?.reasons.length ?? 0) >= 1);
    assert.equal(result.decision?.reasons[0]?.basis, "verified");
    assert.match(result.answer, /Recommendation: yes/i);
    assert.equal(
      formatDecisionAnswer(result.decision!).includes("Next step:"),
      true,
    );
    assert.ok(!/SERP dump/i.test(result.answer));
    assert.equal(result.liveVerification, false);
    assert.equal(result.meta?.llmAttempted, true);
    assert.equal(result.meta?.llmSucceeded, true);
    assert.equal(result.meta?.fallbackUsed, false);
    assert.equal(result.meta?.researchCalls, 0);
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
    assert.equal(result.meta?.llmAttempted, false);
    assert.equal(result.meta?.fallbackUsed, true);
  });

  it("records fallback meta when decision LLM throws", async () => {
    const provider = createFakeLlmProvider({
      handler: () => {
        throw new Error("upstream timeout");
      },
    });
    const result = await answerCandidateQuestion(
      detail(),
      "Should I do this hackathon?",
      { llmProvider: provider },
    );
    assert.equal(result.kind, "decision");
    assert.equal(result.decision, undefined);
    assert.match(result.answer, /Could not complete/i);
    assert.equal(result.meta?.llmAttempted, true);
    assert.equal(result.meta?.llmSucceeded, false);
    assert.equal(result.meta?.fallbackUsed, true);
  });

  it("suggests questions from gaps", () => {
    const suggestions = suggestedCandidateQuestions(
      detail({ deadline: null, prize: null, eligibility: null }),
    );
    assert.ok(suggestions.some((q) => /deadline/i.test(q)));
    assert.ok(suggestions.some((q) => /prizes/i.test(q)));
  });
});

describe("decision / factual parsers", () => {
  it("parses richer reasons with basis and legacy string reasons", () => {
    const rich = parseDecisionRecommendation(
      {
        recommendation: "maybe",
        headline: "Maybe",
        summary: "Unclear fit.",
        reasons: [{ text: "Deadline is soon", basis: "verified" }],
        concerns: [],
        missingInformation: [],
        nextStep: "Check the site",
        confidence: "low",
        citations: [],
      },
      [],
    );
    assert.equal(rich.reasons[0]?.text, "Deadline is soon");
    assert.equal(rich.reasons[0]?.basis, "verified");
    assert.equal(reasonText(rich.reasons[0]!), "Deadline is soon");

    const legacy = parseDecisionRecommendation(
      {
        recommendation: "yes",
        headline: "Go",
        reasons: ["Legacy string reason"],
        concerns: [],
        missingInformation: [],
        nextStep: "Apply",
        confidence: "medium",
        citations: [],
      },
      [],
    );
    assert.equal(legacy.reasons[0]?.text, "Legacy string reason");
    assert.equal(legacy.reasons[0]?.basis, "inferred");
    assert.ok(legacy.summary);
  });

  it("parses factual payload and persisted blob", () => {
    const factual = parseFactualAnswerPayload({
      answer: "The event runs 2026-08-01 to 2026-08-03.",
      certainty: "confirmed",
      supportingFacts: ["startDate: 2026-08-01"],
      citations: [{ url: "https://example.com", label: "Official" }],
    });
    assert.ok(factual);
    assert.equal(factual?.certainty, "confirmed");

    const payload = readPersistedAskPayload({
      kind: "factual",
      certainty: "confirmed",
      liveVerification: false,
      links: [{ url: "https://example.com", label: "Official" }],
      factual,
      decision: null,
    });
    assert.equal(payload.kind, "factual");
    assert.equal(payload.factual?.answer, factual?.answer);
  });
});
