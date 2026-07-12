import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { POST as syncCandidateSheet } from "@/app/api/candidates/[id]/sync-sheet/route";
import type { CandidateCard, CandidateDetail } from "@/core/candidates/types";
import {
  setCandidateRepositoryForTests,
  type CandidateRepository,
} from "@/server/candidates/service";

const SAMPLE_ID = "11111111-1111-4111-8111-111111111111";
const MISSING_ID = "22222222-2222-4222-8222-222222222222";

function baseCard(overrides: Partial<CandidateCard> = {}): CandidateCard {
  return {
    id: SAMPLE_ID,
    status: "APPROVED",
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
    approvedAt: "2026-07-03T12:00:00.000Z",
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
    async listCandidates() {
      return { candidates: [...store.values()], total: store.size };
    },
    async getCandidate(id) {
      return store.get(id) ?? null;
    },
    async updateCandidateStatus(id, status) {
      const existing = store.get(id);
      if (!existing) throw new Error(`Candidate not found: ${id}`);
      const updated = { ...existing, status };
      store.set(id, updated);
      return baseCard(updated);
    },
    async updateSheetMetadata(id, meta) {
      const existing = store.get(id);
      if (!existing) throw new Error(`Candidate not found: ${id}`);
      const updated: CandidateDetail = {
        ...existing,
        sheetRowId: meta.sheetRowId,
        sheetAppendedAt: meta.sheetAppendedAt ?? new Date().toISOString(),
      };
      store.set(id, updated);
      return baseCard(updated);
    },
    async clearSheetMetadata(id) {
      const existing = store.get(id);
      if (!existing) throw new Error(`Candidate not found: ${id}`);
      const updated: CandidateDetail = {
        ...existing,
        sheetRowId: null,
        sheetAppendedAt: null,
      };
      store.set(id, updated);
      return baseCard(updated);
    },
  };
}

afterEach(() => {
  setCandidateRepositoryForTests(null);
});

function sameOriginPost() {
  return new Request("http://localhost/api/candidates/sync-sheet", {
    method: "POST",
    headers: { origin: "http://localhost" },
  });
}

describe("POST /api/candidates/[id]/sync-sheet", () => {
  it("returns already_synced when APPROVED sheet metadata is present", async () => {
    const store = new Map([
      [
        SAMPLE_ID,
        baseDetail({
          status: "APPROVED",
          sheetRowId: "Hackathons!A5:X5",
          sheetAppendedAt: "2026-07-01T15:00:00.000Z",
        }),
      ],
    ]);
    setCandidateRepositoryForTests(createMockRepo(store));

    const response = await syncCandidateSheet(sameOriginPost(), {
      params: Promise.resolve({ id: SAMPLE_ID }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.error, null);
    assert.equal(body.data.sheetSync.status, "already_synced");
    assert.equal(body.data.sheetSync.rowId, "Hackathons!A5:X5");
    assert.equal(body.data.candidate.id, SAMPLE_ID);
  });

  it("reconciles non-APPROVED candidates to already_absent when no row", async () => {
    const store = new Map([[SAMPLE_ID, baseDetail({ status: "NEW" })]]);
    setCandidateRepositoryForTests(createMockRepo(store));

    const response = await syncCandidateSheet(sameOriginPost(), {
      params: Promise.resolve({ id: SAMPLE_ID }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.error, null);
    assert.ok(
      ["already_absent", "skipped_not_configured", "mock_cleared"].includes(
        body.data.sheetSync.status,
      ),
    );
  });

  it("returns 404 when candidate is missing", async () => {
    setCandidateRepositoryForTests(createMockRepo(new Map()));

    const response = await syncCandidateSheet(sameOriginPost(), {
      params: Promise.resolve({ id: MISSING_ID }),
    });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error.code, "CANDIDATE_NOT_FOUND");
  });

  it("returns 400 for invalid uuid", async () => {
    const response = await syncCandidateSheet(sameOriginPost(), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    assert.equal(response.status, 400);
  });
});
