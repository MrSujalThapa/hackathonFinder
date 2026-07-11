import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import {
  createMockCandidateRepository,
  resetMockCandidateStoreForTests,
} from "@/server/candidates/mockStore";
import { POST as approve } from "@/app/api/candidates/[id]/approve/route";
import { POST as reject } from "@/app/api/candidates/[id]/reject/route";
import { POST as save } from "@/app/api/candidates/[id]/save/route";
import { POST as restore } from "@/app/api/candidates/[id]/restore/route";
import { GET as listCandidates } from "@/app/api/candidates/route";
import { setCandidateRepositoryForTests } from "@/server/candidates/service";

const QUEUE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";

afterEach(() => {
  setCandidateRepositoryForTests(null);
  resetMockCandidateStoreForTests();
});

describe("mock candidate workflow", () => {
  it("lists queue candidates in mock mode repository", async () => {
    setCandidateRepositoryForTests(createMockCandidateRepository());
    const response = await listCandidates(
      new Request("http://localhost/api/candidates?status=NEW"),
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.ok(body.data.candidates.length >= 3);
  });

  it("approve/reject/save/restore endpoints update status", async () => {
    setCandidateRepositoryForTests(createMockCandidateRepository());

    let response = await approve(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: QUEUE_ID }),
    });
    assert.equal((await response.json()).data.newStatus, "APPROVED");

    resetMockCandidateStoreForTests();
    setCandidateRepositoryForTests(createMockCandidateRepository());
    response = await reject(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: QUEUE_ID }),
    });
    assert.equal((await response.json()).data.newStatus, "REJECTED");

    response = await restore(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: QUEUE_ID }),
    });
    assert.equal((await response.json()).data.newStatus, "NEW");

    response = await save(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: QUEUE_ID }),
    });
    assert.equal((await response.json()).data.newStatus, "SAVED_FOR_LATER");

    response = await restore(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: QUEUE_ID }),
    });
    assert.equal((await response.json()).data.newStatus, "NEW");
  });
});

describe("optimistic queue rollback helpers", () => {
  it("maps decision failures into restore behavior via API error", async () => {
    const failingRepo = {
      async listCandidates() {
        return { candidates: [], total: 0 };
      },
      async getCandidate() {
        return {
          id: QUEUE_ID,
          status: "NEW" as const,
          score: 1,
          name: "Failing",
          summary: null,
          source: "mock",
          officialUrl: null,
          applyUrl: null,
          socialUrl: null,
          startDate: null,
          endDate: null,
          deadline: null,
          location: null,
          mode: null,
          city: null,
          country: null,
          prize: null,
          themes: [],
          eligibility: null,
          whyMatch: [],
          redFlags: [],
          foundAt: new Date().toISOString(),
          lastVerified: new Date().toISOString(),
          sheetRowId: null,
          sheetAppendedAt: null,
          description: null,
          fingerprint: "x",
          sourceIds: {},
          evidence: [],
          answers: [],
          actions: [],
        };
      },
      async updateCandidateStatus() {
        throw new Error("simulated write failure");
      },
      async updateSheetMetadata() {
        throw new Error("simulated write failure");
      },
    };

    setCandidateRepositoryForTests(failingRepo);
    const response = await approve(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: QUEUE_ID }),
    });
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error.code, "INTERNAL_ERROR");
    assert.match(body.error.message, /simulated write failure/);
  });

  it("records fetch mock for client decideCandidate", async () => {
    const fetchMock = mock.fn(async () =>
      Response.json({
        data: null,
        error: { code: "INTERNAL_ERROR", message: "boom" },
      }, { status: 500 }),
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const { decideCandidate, CandidatesApiError } = await import(
        "@/lib/api/candidates"
      );
      await assert.rejects(
        () => decideCandidate(QUEUE_ID, "approve"),
        (error: unknown) => error instanceof CandidatesApiError,
      );
      assert.equal(fetchMock.mock.callCount(), 1);
      const url = String(
        (fetchMock.mock.calls[0] as { arguments: unknown[] }).arguments[0] ??
          "",
      );
      assert.match(url, /\/approve$/);
    } finally {
      globalThis.fetch = original;
    }
  });
});
