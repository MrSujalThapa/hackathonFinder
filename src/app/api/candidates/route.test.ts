import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { GET as listCandidates } from "@/app/api/candidates/route";
import { GET as listCandidateSources } from "@/app/api/candidates/sources/route";
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
const ORIGIN = "http://localhost";

function mutationRequest(init: RequestInit = {}): Request {
  return new Request(ORIGIN, {
    ...init,
    method: init.method ?? "POST",
    headers: {
      origin: ORIGIN,
      ...(init.headers ?? {}),
    },
  });
}

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
        sourceIds: item.sourceIds,
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
      if (params.statuses?.length) {
        const statuses = new Set(params.statuses);
        candidates = candidates.filter((c) => statuses.has(c.status));
      }
      if (params.source) {
        const source = params.source;
        candidates = candidates.filter(
          (c) => c.source === source || Boolean(c.sourceIds?.[source]),
        );
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
        sourceIds: updated.sourceIds,
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
        sourceIds: updated.sourceIds,
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
    async listPendingSources() {
      const sources = new Set<string>();
      for (const candidate of store.values()) {
        if (candidate.status !== "NEW" && candidate.status !== "NEEDS_REVIEW") continue;
        sources.add(candidate.source);
        for (const key of Object.keys(candidate.sourceIds ?? {})) {
          sources.add(key);
        }
      }
      return [...sources].sort();
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

  it("returns combined pending queue total across NEW and NEEDS_REVIEW", async () => {
    const store = new Map<string, CandidateDetail>();
    for (let index = 0; index < 196; index += 1) {
      const id = `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`;
      store.set(
        id,
        baseDetail({
          id,
          status: index < 22 ? "NEW" : "NEEDS_REVIEW",
          name: `Candidate ${index}`,
          score: 196 - index,
        }),
      );
    }
    setCandidateRepositoryForTests(createMockRepo(store));

    const response = await listCandidates(
      new Request("http://localhost/api/candidates?statuses=NEW,NEEDS_REVIEW&limit=30"),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.error, null);
    assert.equal(body.data.candidates.length, 30);
    assert.equal(body.data.total, 196);
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

  it("returns pending source options from primary and merged source ids", async () => {
    const store = new Map([
      [
        SAMPLE_ID,
        baseDetail({
          source: "hakku",
          sourceIds: { hakku: "h1", luma: "l1" },
          status: "NEEDS_REVIEW",
        }),
      ],
    ]);
    setCandidateRepositoryForTests(createMockRepo(store));

    const response = await listCandidateSources(
      new Request("http://localhost/api/candidates/sources"),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.data.sources, ["hakku", "luma"]);
  });

  it("filters candidates by merged source ids", async () => {
    const store = new Map([
      [
        SAMPLE_ID,
        baseDetail({
          source: "hakku",
          sourceIds: { hakku: "h1", luma: "l1" },
          status: "NEEDS_REVIEW",
        }),
      ],
    ]);
    setCandidateRepositoryForTests(createMockRepo(store));

    const response = await listCandidates(
      new Request("http://localhost/api/candidates?statuses=NEW,NEEDS_REVIEW&source=luma"),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.candidates.length, 1);
    assert.equal(body.data.candidates[0].source, "hakku");
    assert.equal(body.data.total, 1);
  });

  it("accepts encoded custom source filters and matches merged provenance", async () => {
    const store = new Map([
      [
        SAMPLE_ID,
        baseDetail({
          source: "web",
          sourceIds: { web: "w1", "custom:hackathonmap": "map-1" },
          status: "NEEDS_REVIEW",
        }),
      ],
    ]);
    setCandidateRepositoryForTests(createMockRepo(store));

    const response = await listCandidates(
      new Request(
        "http://localhost/api/candidates?statuses=NEW,NEEDS_REVIEW&source=custom%3Ahackathonmap",
      ),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.candidates.length, 1);
    assert.equal(body.data.candidates[0].source, "web");
    assert.equal(body.data.total, 1);
  });

  it("keeps legacy candidates with missing sourceIds from breaking unfiltered queue fetches", async () => {
    const store = new Map([
      [
        SAMPLE_ID,
        baseDetail({
          source: "mlh",
          sourceIds: undefined as never,
          status: "NEW",
        }),
      ],
    ]);
    setCandidateRepositoryForTests(createMockRepo(store));

    const response = await listCandidates(
      new Request("http://localhost/api/candidates?statuses=NEW,NEEDS_REVIEW&limit=30&sort=score"),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.error, null);
    assert.equal(body.data.candidates.length, 1);
  });

  it("accepts valid score cursors for queue pagination", async () => {
    const store = new Map([[SAMPLE_ID, baseDetail()]]);
    setCandidateRepositoryForTests(createMockRepo(store));
    const cursor = Buffer.from(
      "82|2026-07-01T12:00:00.000Z|11111111-1111-4111-8111-111111111111",
      "utf8",
    ).toString("base64url");

    const response = await listCandidates(
      new Request(
        `http://localhost/api/candidates?statuses=NEW,NEEDS_REVIEW&limit=30&sort=score&cursor=${cursor}`,
      ),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.error, null);
  });

  it("returns 400 for malformed cursors", async () => {
    setCandidateRepositoryForTests({
      ...createMockRepo(new Map()),
      async listCandidates(params = {}) {
        if (params.cursor) throw new Error("Invalid cursor.");
        return { candidates: [], total: 0 };
      },
    });

    const response = await listCandidates(
      new Request("http://localhost/api/candidates?cursor=%5Bobject%20Object%5D"),
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, "VALIDATION_ERROR");
  });

  it("returns safe request-id diagnostics when candidate query fails", async () => {
    setCandidateRepositoryForTests({
      ...createMockRepo(new Map()),
      async listCandidates() {
        throw new Error("Failed to list candidates: simulated database failure");
      },
    });

    const response = await listCandidates(
      new Request("http://localhost/api/candidates?statuses=NEW,NEEDS_REVIEW", {
        headers: { "x-request-id": "queue-test-request" },
      }),
    );
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error.code, "CANDIDATE_QUERY_FAILED");
    assert.equal(body.error.details.requestId, "queue-test-request");
    assert.match(body.error.message, /request id/i);
  });

  it("rejects malformed custom source filters", async () => {
    setCandidateRepositoryForTests(createMockRepo(new Map()));
    for (const source of ["custom:bad/slug", "custom:", "other:hackathonmap"]) {
      const response = await listCandidates(
        new Request(`http://localhost/api/candidates?source=${encodeURIComponent(source)}`),
      );
      assert.equal(response.status, 400, source);
    }
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
      mutationRequest({
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
      mutationRequest(),
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
      mutationRequest(),
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
      mutationRequest(),
      { params: Promise.resolve({ id: SAMPLE_ID }) },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.newStatus, "NEW");
  });

  it("returns 404 for unknown candidate decisions", async () => {
    setCandidateRepositoryForTests(createMockRepo(new Map()));
    const response = await approveCandidate(
      mutationRequest(),
      { params: Promise.resolve({ id: MISSING_ID }) },
    );
    assert.equal(response.status, 404);
  });

  it("rejects cross-origin candidate decisions", async () => {
    const store = new Map([[SAMPLE_ID, baseDetail()]]);
    setCandidateRepositoryForTests(createMockRepo(store));

    const response = await approveCandidate(
      new Request(ORIGIN, {
        method: "POST",
        headers: { origin: "https://attacker.example" },
      }),
      { params: Promise.resolve({ id: SAMPLE_ID }) },
    );

    assert.equal(response.status, 403);
  });

  it("exposes repository via getter for wiring checks", () => {
    assert.ok(getCandidateRepository().listCandidates);
  });
});
