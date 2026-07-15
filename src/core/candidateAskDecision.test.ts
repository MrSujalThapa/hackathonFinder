import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asDecisionReasons,
  classifyCandidateQuestion,
  formatDecisionAnswer,
  parseDecisionRecommendation,
  parseFactualAnswerPayload,
  reasonText,
} from "@/core/candidateAskDecision";

describe("candidateAskDecision schemas", () => {
  it("classifies date as factual and should-I as decision", () => {
    assert.equal(classifyCandidateQuestion("date?"), "factual");
    assert.equal(
      classifyCandidateQuestion("Should I do this hackathon?"),
      "decision",
    );
  });

  it("formats decision answers from reason objects", () => {
    const decision = parseDecisionRecommendation(
      {
        recommendation: "yes",
        headline: "Worth a weekend.",
        summary: "Good fit for agent practice if remote works for you.",
        reasons: [
          { text: "Online mode is confirmed", basis: "verified" },
          { text: "Themes match AI agents", basis: "inferred" },
        ],
        concerns: ["Deadline is soon"],
        missingInformation: ["Judging weights"],
        nextStep: "Apply on the official page",
        confidence: "medium",
        citations: [{ url: "https://example.com", label: "Official" }],
      },
      [],
    );
    const text = formatDecisionAnswer(decision);
    assert.match(text, /Recommendation: yes/);
    assert.match(text, /Online mode is confirmed/);
    assert.match(text, /Good fit for agent practice/);
    assert.equal(reasonText(decision.reasons[0]!), "Online mode is confirmed");
  });

  it("normalizes mixed reason shapes", () => {
    const reasons = asDecisionReasons([
      "plain",
      { text: "object", basis: "verified" },
      { text: "", basis: "verified" },
      null,
    ]);
    assert.equal(reasons.length, 2);
    assert.equal(reasons[0]?.basis, "inferred");
    assert.equal(reasons[1]?.basis, "verified");
  });

  it("parses factual answer payloads", () => {
    const factual = parseFactualAnswerPayload({
      answer: "Deadline is 2026-07-25.",
      certainty: "confirmed",
      supportingFacts: ["deadline: 2026-07-25"],
      citations: [],
    });
    assert.equal(factual?.answer, "Deadline is 2026-07-25.");
    assert.equal(parseFactualAnswerPayload({ certainty: "confirmed" }), null);
  });
});
