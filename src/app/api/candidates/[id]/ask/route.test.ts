import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import type { CandidateDetail } from "@/core/candidates/types";
import { POST } from "@/app/api/candidates/[id]/ask/route";
import { setCandidateRepositoryForTests, type CandidateRepository } from "@/server/candidates/service";

function detail(overrides: Partial<CandidateDetail> = {}): CandidateDetail {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    status: "NEW",
    score: 80,
    name: "AI Hack",
    summary: "AI hackathon",
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
    themes: ["AI"],
    eligibility: "Students",
    whyMatch: ["Remote/online event"],
    redFlags: [],
    foundAt: "2026-07-01T00:00:00Z",
    lastVerified: "2026-07-01T00:00:00Z",
    approvedAt: null,
    sheetRowId: null,
    sheetAppendedAt: null,
    description: "Build AI projects.",
    fingerprint: "official:https://example.com",
    sourceIds: {},
    evidence: [{
      id: "e1",
      candidateId: "11111111-1111-4111-8111-111111111111",
      type: "official_page",
      url: "https://example.com",
      title: "Official event page",
      snippet: "Deadline: July 25, 2026",
      raw: {},
      foundAt: "2026-07-01T00:00:00Z",
    }],
    answers: [],
    actions: [],
    ...overrides,
  };
}

afterEach(() => setCandidateRepositoryForTests(null));

describe("POST /api/candidates/[id]/ask", () => {
  it("answers from existing candidate fields and persists the answer", async () => {
    const candidate = detail();
    const answers: unknown[] = [];
    const repo: CandidateRepository = {
      async listCandidates() { return { candidates: [] }; },
      async getCandidate() { return { ...candidate, answers: answers as CandidateDetail["answers"] }; },
      async updateCandidateStatus() { throw new Error("status mutation forbidden"); },
      async updateSheetMetadata() { throw new Error("sheet mutation forbidden"); },
      async addCandidateAnswer(_id, answer) {
        answers.push({ id: "a1", ...answer, createdAt: "now" });
        return answers[0];
      },
    };
    setCandidateRepositoryForTests(repo);

    const response = await POST(
      new Request("http://test.local", {
        method: "POST",
        headers: { origin: "http://test.local" },
        body: JSON.stringify({ question: "What is the deadline?" }),
      }),
      { params: Promise.resolve({ id: candidate.id }) },
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.confidence, "high");
    assert.match(body.data.answer, /2026-07-25/);
    assert.equal(answers.length, 1);
    assert.equal(body.data.updatedCandidate.status, "NEW");
  });
});
