import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type {
  AddActionInput,
  CandidateAction,
  CandidateCard,
  CandidateDetail,
} from "@/core/candidates/types";
import { GoogleSheetsError } from "@/lib/google/types";
import { setCandidateRepositoryForTests } from "@/server/candidates/service";
import {
  appendApprovedCandidate,
  type AppendDeps,
} from "@/server/sheets/appendApprovedCandidate";
import { SHEET_HEADERS } from "@/server/sheets/schema";
import { syncPendingApproved } from "@/server/sheets/syncPendingApproved";

const CANDIDATE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function baseCandidate(
  overrides: Partial<CandidateDetail> = {},
): CandidateDetail {
  return {
    id: CANDIDATE_ID,
    status: "APPROVED",
    score: 90,
    name: "Test Hack",
    summary: "A test hackathon",
    source: "test",
    officialUrl: "https://example.com",
    applyUrl: "https://example.com/apply",
    socialUrl: null,
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    deadline: "2026-08-15",
    location: "Toronto",
    mode: "hybrid",
    city: "Toronto",
    country: "Canada",
    prize: "$1,000",
    themes: ["AI"],
    eligibility: "Open",
    whyMatch: ["fit"],
    redFlags: [],
    foundAt: "2026-07-01T12:00:00.000Z",
    lastVerified: "2026-07-02T12:00:00.000Z",
    sheetRowId: null,
    sheetAppendedAt: null,
    description: "desc",
    fingerprint: "fp-test",
    sourceIds: {},
    evidence: [],
    answers: [],
    actions: [],
    ...overrides,
  };
}

type FakeStore = {
  candidate: CandidateDetail | null;
  actions: CandidateAction[];
  appendCalls: number;
  findResult: { rowNumber: number; range: string } | null;
  metadataShouldFail: boolean;
  appendShouldFail: boolean;
  ensureHeadersShouldFail: boolean;
};

function createFakeRepo(store: FakeStore) {
  return {
    async listCandidates() {
      const candidates = store.candidate ? [toCard(store.candidate)] : [];
      return { candidates, total: candidates.length };
    },
    async getCandidate(id: string) {
      if (!store.candidate || store.candidate.id !== id) return null;
      return { ...store.candidate, actions: [...store.actions] };
    },
    async updateCandidateStatus() {
      throw new Error("not used");
    },
    async updateSheetMetadata(
      id: string,
      meta: { sheetRowId: string; sheetAppendedAt?: string },
    ): Promise<CandidateCard> {
      if (!store.candidate || store.candidate.id !== id) {
        throw new Error(`Candidate not found: ${id}`);
      }
      if (store.metadataShouldFail) {
        throw new Error("metadata write failed");
      }
      store.candidate = {
        ...store.candidate,
        sheetRowId: meta.sheetRowId,
        sheetAppendedAt: meta.sheetAppendedAt ?? "2026-07-11T12:00:00.000Z",
      };
      return toCard(store.candidate);
    },
    async addAction(candidateId: string, action: AddActionInput) {
      const record: CandidateAction = {
        id: `action-${store.actions.length + 1}`,
        candidateId,
        action: action.action,
        previousStatus: action.previousStatus ?? null,
        newStatus: action.newStatus ?? null,
        reason: action.reason ?? null,
        metadata: action.metadata ?? {},
        createdAt: "2026-07-11T12:00:00.000Z",
      };
      store.actions.unshift(record);
      return record;
    },
  };
}

function toCard(candidate: CandidateDetail): CandidateCard {
  return {
    id: candidate.id,
    status: candidate.status,
    score: candidate.score,
    name: candidate.name,
    summary: candidate.summary,
    source: candidate.source,
    officialUrl: candidate.officialUrl,
    applyUrl: candidate.applyUrl,
    socialUrl: candidate.socialUrl,
    startDate: candidate.startDate,
    endDate: candidate.endDate,
    deadline: candidate.deadline,
    location: candidate.location,
    mode: candidate.mode,
    city: candidate.city,
    country: candidate.country,
    prize: candidate.prize,
    themes: candidate.themes,
    eligibility: candidate.eligibility,
    whyMatch: candidate.whyMatch,
    redFlags: candidate.redFlags,
    foundAt: candidate.foundAt,
    lastVerified: candidate.lastVerified,
    sheetRowId: candidate.sheetRowId,
    sheetAppendedAt: candidate.sheetAppendedAt,
  };
}

function createDeps(store: FakeStore, overrides: Partial<AppendDeps> = {}): Partial<AppendDeps> {
  const repo = createFakeRepo(store);
  setCandidateRepositoryForTests(repo);

  return {
    isMockCandidatesEnabled: () => false,
    hasGoogleSheetsConfig: () => true,
    getGoogleSheetsConfig: () => ({
      spreadsheetId: "sheet-id",
      tabName: "Hackathons",
      serviceAccount: {
        client_email: "sa@example.com",
        private_key: "key",
      },
    }),
    ensureHeaders: async () => {
      if (store.ensureHeadersShouldFail) {
        throw new GoogleSheetsError(
          "incompatible_headers",
          `Incompatible sheet headers: expected ${SHEET_HEADERS.length} columns, found 2`,
        );
      }
    },
    findRowByCandidateId: async () => store.findResult,
    appendRow: async () => {
      store.appendCalls += 1;
      if (store.appendShouldFail) {
        throw new GoogleSheetsError("network_failure", "Google API unavailable");
      }
      return { updatedRange: "Hackathons!A5:X5" };
    },
    now: () => "2026-07-11T12:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  setCandidateRepositoryForTests(null);
});

describe("appendApprovedCandidate", () => {
  it("appends on first sync and stores sheet metadata", async () => {
    const store: FakeStore = {
      candidate: baseCandidate(),
      actions: [],
      appendCalls: 0,
      findResult: null,
      metadataShouldFail: false,
      appendShouldFail: false,
      ensureHeadersShouldFail: false,
    };
    const deps = createDeps(store);

    const result = await appendApprovedCandidate(CANDIDATE_ID, deps);

    assert.equal(result.status, "appended");
    assert.equal(result.rowId, "Hackathons!A5:X5");
    assert.equal(store.appendCalls, 1);
    assert.equal(store.candidate?.sheetRowId, "Hackathons!A5:X5");
    assert.equal(store.candidate?.sheetAppendedAt, "2026-07-11T12:00:00.000Z");
    assert.equal(store.actions[0]?.action, "SHEET_APPEND");
    assert.deepEqual(store.actions[0]?.metadata, {
      ok: true,
      rowId: "Hackathons!A5:X5",
    });
  });

  it("returns already_synced when metadata is present", async () => {
    const store: FakeStore = {
      candidate: baseCandidate({
        sheetRowId: "Hackathons!A3:X3",
        sheetAppendedAt: "2026-07-10T00:00:00.000Z",
      }),
      actions: [],
      appendCalls: 0,
      findResult: null,
      metadataShouldFail: false,
      appendShouldFail: false,
      ensureHeadersShouldFail: false,
    };
    const deps = createDeps(store);

    const result = await appendApprovedCandidate(CANDIDATE_ID, deps);

    assert.equal(result.status, "already_synced");
    assert.equal(result.rowId, "Hackathons!A3:X3");
    assert.equal(store.appendCalls, 0);
    assert.equal(store.actions.length, 0);
  });

  it("recovers when Candidate ID exists in sheet but Supabase metadata is missing", async () => {
    const store: FakeStore = {
      candidate: baseCandidate(),
      actions: [],
      appendCalls: 0,
      findResult: { rowNumber: 4, range: "Hackathons!X4" },
      metadataShouldFail: false,
      appendShouldFail: false,
      ensureHeadersShouldFail: false,
    };
    const deps = createDeps(store);

    const result = await appendApprovedCandidate(CANDIDATE_ID, deps);

    assert.equal(result.status, "recovered_existing_row");
    assert.equal(result.rowId, "Hackathons!X4");
    assert.equal(store.appendCalls, 0);
    assert.equal(store.candidate?.sheetRowId, "Hackathons!X4");
    assert.deepEqual(store.actions[0]?.metadata, {
      ok: true,
      recovered: true,
      rowId: "Hackathons!X4",
      rowNumber: 4,
    });
  });

  it("skips NEW and REJECTED candidates", async () => {
    for (const status of ["NEW", "REJECTED"] as const) {
      const store: FakeStore = {
        candidate: baseCandidate({ status }),
        actions: [],
        appendCalls: 0,
        findResult: null,
        metadataShouldFail: false,
        appendShouldFail: false,
        ensureHeadersShouldFail: false,
      };
      const deps = createDeps(store);

      const result = await appendApprovedCandidate(CANDIDATE_ID, deps);

      assert.equal(result.status, "skipped_not_approved");
      assert.equal(store.appendCalls, 0);
    }
  });

  it("retries after append+metadata failure by recovering without a second append", async () => {
    const store: FakeStore = {
      candidate: baseCandidate(),
      actions: [],
      appendCalls: 0,
      findResult: null,
      metadataShouldFail: true,
      appendShouldFail: false,
      ensureHeadersShouldFail: false,
    };
    const deps = createDeps(store);

    const first = await appendApprovedCandidate(CANDIDATE_ID, deps);
    assert.equal(first.status, "failed");
    assert.equal(first.rowId, "Hackathons!A5:X5");
    assert.match(first.message ?? "", /metadata update failed/i);
    assert.equal(store.appendCalls, 1);
    assert.equal(store.candidate?.sheetRowId, null);

    // Simulate sheet now containing the row from the successful append.
    store.findResult = { rowNumber: 5, range: "Hackathons!A5:X5" };
    store.metadataShouldFail = false;

    const second = await appendApprovedCandidate(CANDIDATE_ID, deps);
    assert.equal(second.status, "recovered_existing_row");
    assert.equal(second.rowId, "Hackathons!A5:X5");
    assert.equal(store.appendCalls, 1, "must not append a second time");
    assert.equal(store.candidate?.sheetRowId, "Hackathons!A5:X5");
  });

  it("fails on incompatible headers without appending", async () => {
    const store: FakeStore = {
      candidate: baseCandidate(),
      actions: [],
      appendCalls: 0,
      findResult: null,
      metadataShouldFail: false,
      appendShouldFail: false,
      ensureHeadersShouldFail: true,
    };
    const deps = createDeps(store);

    const result = await appendApprovedCandidate(CANDIDATE_ID, deps);

    assert.equal(result.status, "failed");
    assert.match(result.message ?? "", /Incompatible sheet headers/);
    assert.equal(store.appendCalls, 0);
    assert.equal(store.candidate?.status, "APPROVED");
  });

  it("returns failed on Google API errors while leaving candidate APPROVED", async () => {
    const store: FakeStore = {
      candidate: baseCandidate(),
      actions: [],
      appendCalls: 0,
      findResult: null,
      metadataShouldFail: false,
      appendShouldFail: true,
      ensureHeadersShouldFail: false,
    };
    const deps = createDeps(store);

    const result = await appendApprovedCandidate(CANDIDATE_ID, deps);

    assert.equal(result.status, "failed");
    assert.match(result.message ?? "", /Google API unavailable/);
    assert.equal(store.candidate?.status, "APPROVED");
    assert.equal(store.candidate?.sheetRowId, null);
    assert.equal(store.actions[0]?.action, "SHEET_APPEND");
    assert.equal((store.actions[0]?.metadata as { ok?: boolean }).ok, false);
  });

  it("returns mock_synced when mock candidates are enabled", async () => {
    const store: FakeStore = {
      candidate: baseCandidate(),
      actions: [],
      appendCalls: 0,
      findResult: null,
      metadataShouldFail: false,
      appendShouldFail: false,
      ensureHeadersShouldFail: false,
    };
    const deps = createDeps(store, {
      isMockCandidatesEnabled: () => true,
    });

    const result = await appendApprovedCandidate(CANDIDATE_ID, deps);

    assert.equal(result.status, "mock_synced");
    assert.equal(result.rowId, `mock-row:${CANDIDATE_ID}`);
    assert.equal(store.appendCalls, 0);
    assert.deepEqual(store.actions[0]?.metadata, {
      ok: true,
      mock: true,
      rowId: `mock-row:${CANDIDATE_ID}`,
    });
  });

  it("returns skipped_not_configured when sheets env is missing", async () => {
    const store: FakeStore = {
      candidate: baseCandidate(),
      actions: [],
      appendCalls: 0,
      findResult: null,
      metadataShouldFail: false,
      appendShouldFail: false,
      ensureHeadersShouldFail: false,
    };
    const deps = createDeps(store, {
      hasGoogleSheetsConfig: () => false,
    });

    const result = await appendApprovedCandidate(CANDIDATE_ID, deps);

    assert.equal(result.status, "skipped_not_configured");
    assert.equal(store.appendCalls, 0);
  });

  it("returns failed when candidate is missing", async () => {
    const store: FakeStore = {
      candidate: null,
      actions: [],
      appendCalls: 0,
      findResult: null,
      metadataShouldFail: false,
      appendShouldFail: false,
      ensureHeadersShouldFail: false,
    };
    const deps = createDeps(store);

    const result = await appendApprovedCandidate(CANDIDATE_ID, deps);

    assert.equal(result.status, "failed");
    assert.match(result.message ?? "", /not found/i);
  });
});

describe("syncPendingApproved", () => {
  it("dryRun counts pending without writing", async () => {
    const store: FakeStore = {
      candidate: baseCandidate(),
      actions: [],
      appendCalls: 0,
      findResult: null,
      metadataShouldFail: false,
      appendShouldFail: false,
      ensureHeadersShouldFail: false,
    };
    setCandidateRepositoryForTests(createFakeRepo(store));

    const summary = await syncPendingApproved({ dryRun: true });

    assert.equal(summary.checked, 1);
    assert.equal(summary.appended, 0);
    assert.equal(summary.results.length, 0);
    assert.equal(store.appendCalls, 0);
  });

  it("skips already-synced approved candidates", async () => {
    const store: FakeStore = {
      candidate: baseCandidate({
        sheetRowId: "Hackathons!A2:X2",
        sheetAppendedAt: "2026-07-10T00:00:00.000Z",
      }),
      actions: [],
      appendCalls: 0,
      findResult: null,
      metadataShouldFail: false,
      appendShouldFail: false,
      ensureHeadersShouldFail: false,
    };
    setCandidateRepositoryForTests(createFakeRepo(store));

    const summary = await syncPendingApproved({ dryRun: false });

    assert.equal(summary.checked, 0);
    assert.equal(summary.appended, 0);
  });
});
