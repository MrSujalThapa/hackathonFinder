import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { GET as listCandidates } from "@/app/api/candidates/route";
import { GET as getCandidate } from "@/app/api/candidates/[id]/route";
import { POST as approveCandidate } from "@/app/api/candidates/[id]/approve/route";
import { POST as rejectCandidate } from "@/app/api/candidates/[id]/reject/route";
import { POST as saveCandidate } from "@/app/api/candidates/[id]/save/route";
import { POST as restoreCandidate } from "@/app/api/candidates/[id]/restore/route";
import type { CandidateCard, CandidateDetail } from "@/core/candidates/types";
import {
  getCandidateRepository,
  setCandidateRepositoryForTests,
  type CandidateRepository,
} from "@/server/candidates/service";

const SAMPLE_ID = "11111111-1111-4111-8111-111111111111";
const MISSING_ID = "22222222-2222-4222-8222-222222222222";

function baseCard(overrides: Partial<CandidateCard> = {}): CandidateCard {
  return {
    id: SAMPLE_ID,
    status: "NEW",
    score: 82,
    name: "HackTO AI Challenge",
    summary: "Toronto AI hackathon",
    source: "mock",
    officialUrl: "https://hackto.example.com/ai-challenge",
    applyUrl: "https://hackto.example.com/ai-challenge/apply",
    socialUrl: null,
    startDate: "2026-09-13",
    endDate: "2026-09-15",
    deadline: "2026-08-15",
    location: "Toronto, Canada",
    mode: "in-person",
    city: "Toronto",
    country: "Canada",
    prize: "$10,000",
    themes: ["AI", "agents"],
    eligibility: "Open",
    whyMatch: ["AI theme"],
    redFlags: [],
    foundAt: "2026-07-01T12:00:00.000Z",
    lastVerified: "2026-07-01T12:00:00.000Z",
    approvedAt: null,
    sheetRowId: null,
    sheetAppendedAt: null,
    ...overrides,
  };
}

function baseDetail(overrides: Partial<CandidateDetail> = {}): CandidateDetail {
  return {
    ...baseCard(),
    description: "Full description",
    fingerprint: "fp-1",
    sourceIds: { mock: "hackto-ai" },
    evidence: [],
    answers: [],
    actions: [],
    ...overrides,
  };
}

function createMockRepo(
  store: Map<string, CandidateDetail>,
): CandidateRepository {
  return {
    async listCandidates(params = {}) {
      let candidates = [...store.values()].map((item) => ({
        id: item.id,
        status: item.status,
        score: item.score,
        name: item.name,
        summary: item.summary,
        source: item.source,
        officialUrl: item.officialUrl,
        applyUrl: item.applyUrl,
        socialUrl: item.socialUrl,
        startDate: item.startDate,
        endDate: item.endDate,
        deadline: item.deadline,
        location: item.location,
        mode: item.mode,
        city: item.city,
        country: item.country,
        prize: item.prize,
        themes: item.themes,
        eligibility: item.eligibility,
        whyMatch: item.whyMatch,
        redFlags: item.redFlags,
        foundAt: item.foundAt,
        lastVerified: item.lastVerified,
        approvedAt: item.approvedAt,
        sheetRowId: item.sheetRowId,
        sheetAppendedAt: item.sheetAppendedAt,
      }));
      if (params.status) {
        candidates = candidates.filter((c) => c.status === params.status);
      }
      if (params.source) {
        candidates = candidates.filter((c) => c.source === params.source);
      }
      const limit = params.limit ?? 20;
      return {
        candidates: candidates.slice(0, limit),
        total: candidates.length,
      };
    },
    async getCandidate(id) {
      return store.get(id) ?? null;
    },
    async updateCandidateStatus(id, status) {
      const existing = store.get(id);
      if (!existing) {
        throw new Error(`Candidate not found: ${id}`);
      }
      const updated: CandidateDetail = { ...existing, status };
      store.set(id, updated);
      return {
        id: updated.id,
        status: updated.status,
        score: updated.score,
        name: updated.name,
        summary: updated.summary,
        source: updated.source,
        officialUrl: updated.officialUrl,
        applyUrl: updated.applyUrl,
        socialUrl: updated.socialUrl,
        startDate: updated.startDate,
        endDate: updated.endDate,
        deadline: updated.deadline,
        location: updated.location,
        mode: updated.mode,
        city: updated.city,
        country: updated.country,
        prize: updated.prize,
        themes: updated.themes,
        eligibility: updated.eligibility,
        whyMatch: updated.whyMatch,
        redFlags: updated.redFlags,
        foundAt: updated.foundAt,
        lastVerified: updated.lastVerified,
        approvedAt: updated.approvedAt,
        sheetRowId: updated.sheetRowId,
        sheetAppendedAt: updated.sheetAppendedAt,
      };
    },
    async updateSheetMetadata(id, meta) {
      const existing = store.get(id);
      if (!existing) {
        throw new Error(`Candidate not found: ${id}`);
      }
      const updated: CandidateDetail = {
        ...existing,
        sheetRowId: meta.sheetRowId,
        sheetAppendedAt: meta.sheetAppendedAt ?? new Date().toISOString(),
      };
      store.set(id, updated);
      return {
        id: updated.id,
        status: updated.status,
        score: updated.score,
        name: updated.name,
        summary: updated.summary,
        source: updated.source,
        officialUrl: updated.officialUrl,
        applyUrl: updated.applyUrl,
        socialUrl: updated.socialUrl,
        startDate: updated.startDate,
        endDate: updated.endDate,
        deadline: updated.deadline,
        location: updated.location,
        mode: updated.mode,
        city: updated.city,
        country: updated.country,
        prize: updated.prize,
        themes: updated.themes,
        eligibility: updated.eligibility,
        whyMatch: updated.whyMatch,
        redFlags: updated.redFlags,
        foundAt: updated.foundAt,
        lastVerified: updated.lastVerified,
        approvedAt: updated.approvedAt,
        sheetRowId: updated.sheetRowId,
        sheetAppendedAt: updated.sheetAppendedAt,
      };
    },
  };
}

afterEach(() => {
  setCandidateRepositoryForTests(null);
});

describe("GET /api/candidates", () => {
  it("returns candidates from the repository", async () => {
    const store = new Map([[SAMPLE_ID, baseDetail()]]);
    setCandidateRepositoryForTests(createMockRepo(store));

    const response = await listCandidates(
      new Request("http://localhost/api/candidates?status=NEW&limit=10"),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.error, null);
    assert.equal(body.data.candidates.length, 1);
    assert.equal(body.data.candidates[0].name, "HackTO AI Challenge");
  });

  it("returns 400 for invalid status", async () => {
    setCandidateRepositoryForTests(createMockRepo(new Map()));
    const response = await listCandidates(
      new Request("http://localhost/api/candidates?status=NOPE"),
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, "VALIDATION_ERROR");
  });
});

describe("GET /api/candidates/[id]", () => {
  it("returns candidate detail", async () => {
    const store = new Map([[SAMPLE_ID, baseDetail()]]);
    setCandidateRepositoryForTests(createMockRepo(store));

    const response = await getCandidate(new Request("http://localhost"), {
      params: Promise.resolve({ id: SAMPLE_ID }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.candidate.id, SAMPLE_ID);
  });

  it("returns 404 when missing", async () => {
    setCandidateRepositoryForTests(createMockRepo(new Map()));
    const response = await getCandidate(new Request("http://localhost"), {
      params: Promise.resolve({ id: MISSING_ID }),
    });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error.code, "CANDIDATE_NOT_FOUND");
  });

  it("returns 400 for invalid uuid", async () => {
    const response = await getCandidate(new Request("http://localhost"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    assert.equal(response.status, 400);
  });
});

describe("decision endpoints", () => {
  it("approves a candidate", async () => {
    const store = new Map([[SAMPLE_ID, baseDetail()]]);
    setCandidateRepositoryForTests(createMockRepo(store));

    const response = await approveCandidate(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: SAMPLE_ID }) },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.newStatus, "APPROVED");
    assert.equal(store.get(SAMPLE_ID)?.status, "APPROVED");
    // Sheet sync is a separate /sync-sheet follow-up so approve stays fast.
    assert.equal(body.data.sheetSync, null);
  });

  it("rejects a candidate", async () => {
    const store = new Map([[SAMPLE_ID, baseDetail()]]);
    setCandidateRepositoryForTests(createMockRepo(store));

    const response = await rejectCandidate(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ id: SAMPLE_ID }) },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.newStatus, "REJECTED");
    assert.equal(body.data.sheetSync, null);
  });

  it("saves a candidate", async () => {
    const store = new Map([[SAMPLE_ID, baseDetail()]]);
    setCandidateRepositoryForTests(createMockRepo(store));

    const response = await saveCandidate(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ id: SAMPLE_ID }) },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.newStatus, "SAVED_FOR_LATER");
  });

  it("restores a rejected candidate to NEW", async () => {
    const store = new Map([
      [SAMPLE_ID, baseDetail({ status: "REJECTED" })],
    ]);
    setCandidateRepositoryForTests(createMockRepo(store));

    const response = await restoreCandidate(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ id: SAMPLE_ID }) },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.newStatus, "NEW");
  });

  it("returns 404 for unknown candidate decisions", async () => {
    setCandidateRepositoryForTests(createMockRepo(new Map()));
    const response = await approveCandidate(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ id: MISSING_ID }) },
    );
    assert.equal(response.status, 404);
  });

  it("exposes repository via getter for wiring checks", () => {
    assert.ok(getCandidateRepository().listCandidates);
  });
});
