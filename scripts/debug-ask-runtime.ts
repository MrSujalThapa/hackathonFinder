/**
 * Temporary STEP 5 audit helper — does not change production Ask behavior.
 * Run: npx tsx scripts/debug-ask-runtime.ts
 */
import {
  classifyCandidateQuestion,
} from "../src/core/candidateAskDecision";
import { answerCandidateQuestion } from "../src/core/candidateQuestionAnswer";
import type { CandidateDetail } from "../src/core/candidates/types";
import { createFakeLlmProvider } from "../src/lib/llm/providers/fake";
import type { SearchProvider } from "../src/lib/search/types";

const detail: CandidateDetail = {
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
  themes: ["AI"],
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
      snippet: "Teams of 1-4. Event runs Aug 1-3.",
      raw: {},
      foundAt: "2026-07-01T00:00:00Z",
    },
  ],
  answers: [],
  actions: [],
};

const searchProvider: SearchProvider = {
  name: "mock-debug",
  async search() {
    return [
      {
        title: "Random blog about dates",
        url: "https://search.example/noise",
        snippet:
          "Unrelated SEO copy mentioning registration windows and calendar tips.",
        source: "mock",
      },
    ];
  },
};

function summarize(label: string, result: Awaited<ReturnType<typeof answerCandidateQuestion>>) {
  console.log(`\n=== ${label} ===`);
  console.log(
    JSON.stringify(
      {
        kind: result.kind,
        certainty: result.certainty,
        confidence: result.confidence,
        liveVerification: result.liveVerification,
        hasDecision: Boolean(result.decision),
        decision: result.decision ?? null,
        answer: result.answer,
        sources: result.sources,
      },
      null,
      2,
    ),
  );
}

async function main() {
  console.log("classifier date?:", classifyCandidateQuestion("date?"));
  console.log(
    "classifier Should I do this hackathon?:",
    classifyCandidateQuestion("Should I do this hackathon?"),
  );

  summarize(
    "Q1 date? + search",
    await answerCandidateQuestion(detail, "date?", {
      searchProvider,
      llmProvider: null,
      maxSearchCalls: 1,
    }),
  );

  summarize(
    "Q1 date? no search",
    await answerCandidateQuestion(detail, "date?", {
      searchProvider: null,
      llmProvider: null,
    }),
  );

  summarize(
    "Q2 decision no LLM",
    await answerCandidateQuestion(detail, "Should I do this hackathon?", {
      llmProvider: null,
      searchProvider,
    }),
  );

  const llm = createFakeLlmProvider({
    handler: () =>
      JSON.stringify({
        recommendation: "yes",
        headline: "Worth doing if you want agent practice.",
        reasons: ["Remote format fits.", "AI theme aligns."],
        concerns: ["Prize details sparse."],
        missingInformation: ["Judging rubric."],
        nextStep: "Confirm eligibility then apply.",
        confidence: "medium",
        citations: [{ url: "https://example.com", label: "Official event page" }],
      }),
  });

  summarize(
    "Q2 decision fake LLM + search (search should be ignored)",
    await answerCandidateQuestion(detail, "Should I do this hackathon?", {
      llmProvider: llm,
      searchProvider,
    }),
  );

  const badLlm = createFakeLlmProvider({
    handler: () => {
      throw new Error("boom");
    },
  });

  summarize(
    "Q2 decision LLM throws",
    await answerCandidateQuestion(detail, "Should I do this hackathon?", {
      llmProvider: badLlm,
    }),
  );

  // Prove startDate is present but unused for "date?"
  console.log("\n=== stored dates (unused by date? handler) ===");
  console.log({
    startDate: detail.startDate,
    endDate: detail.endDate,
    deadline: detail.deadline,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
