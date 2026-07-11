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
import type { AppendDeps } from "@/server/sheets/appendApprovedCandidate";
import type { DeleteRowDeps } from "@/server/sheets/deleteRowByCandidateId";
import { reconcileCandidateSheetState } from "@/server/sheets/reconcileCandidateSheetState";
import type { SheetSyncResult } from "@/server/sheets/types";

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
    approvedAt: "2026-07-03T12:00:00.000Z",
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
    approvedAt: candidate.approvedAt ?? null,
    sheetRowId: candidate.sheetRowId,
    sheetAppendedAt: candidate.sheetAppendedAt,
  };
}

type FakeStore = {
  candidate: CandidateDetail | null;
  actions: CandidateAction[];
  findResult: { rowNumber: number; range: string } | null;
  deleteCalls: number;
  findCalls: number;
  deleteShouldFail: boolean;
  clearShouldFail: boolean;
  appendResults: SheetSyncResult[];
  appendCalls: number;
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
      store.candidate = {
        ...store.candidate,
        sheetRowId: meta.sheetRowId,
        sheetAppendedAt: meta.sheetAppendedAt ?? "2026-07-11T12:00:00.000Z",
      };
      return toCard(store.candidate);
    },
    async clearSheetMetadata(id: string): Promise<CandidateCard> {
      if (!store.candidate || store.candidate.id !== id) {
        throw new Error(`Candidate not found: ${id}`);
      }
      if (store.clearShouldFail) {
        throw new Error("metadata clear failed");
      }
      store.candidate = {
        ...store.candidate,
        sheetRowId: null,
        sheetAppendedAt: null,
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

function createDeleteRowDeps(store: FakeStore): Partial<DeleteRowDeps> {
  return {
    hasGoogleSheetsConfig: () => true,
    getGoogleSheetsConfig: () => ({
      spreadsheetId: "sheet-id",
      tabName: "Hackathons",
      serviceAccount: {
        client_email: "sa@example.com",
        private_key: "key",
      },
    }),
    findRowByCandidateId: async () => {
      store.findCalls += 1;
      return store.findResult;
    },
    getSheetIdByTitle: async () => 42,
    deleteDimensionRow: async (_spreadsheetId, _sheetId, rowNumber) => {
      store.deleteCalls += 1;
      if (store.deleteShouldFail) {
        throw new GoogleSheetsError("network_failure", "Google API delete failed");
      }
      store.findResult = null;
      return { sheetId: 42, rowNumber };
    },
  };
}

function createReconcileDeps(
  store: FakeStore,
  overrides: Partial<Parameters<typeof reconcileCandidateSheetState>[1]> = {},
) {
  const repo = createFakeRepo(store);
  setCandidateRepositoryForTests(repo);

  const deleteRowDeps = createDeleteRowDeps(store);

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
    deleteRowDeps,
    appendApprovedCandidate: async (
      candidateId: string,
      _deps?: Partial<AppendDeps>,
    ): Promise<SheetSyncResult> => {
      store.appendCalls += 1;
      const next = store.appendResults.shift();
      if (next) return next;
      const rowId = "Hackathons!A5:X5";
      store.candidate = store.candidate
        ? {
            ...store.candidate,
            sheetRowId: rowId,
            sheetAppendedAt: "2026-07-11T12:00:00.000Z",
          }
        : store.candidate;
      return { status: "appended", candidateId, rowId };
    },
    ...overrides,
  };
}

afterEach(() => {
  setCandidateRepositoryForTests(null);
});

describe("reconcileCandidateSheetState", () => {
  it("approve creates one row (delegates to append)", async () => {
    const store: FakeStore = {
      candidate: baseCandidate(),
      actions: [],
      findResult: null,
      deleteCalls: 0,
      findCalls: 0,
      deleteShouldFail: false,
      clearShouldFail: false,
      appendResults: [],
      appendCalls: 0,
    };
    const deps = createReconcileDeps(store);

    const result = await reconcileCandidateSheetState(CANDIDATE_ID, deps);

    assert.equal(result.status, "appended");
    assert.equal(result.direction, "ensure_present");
    assert.equal(store.appendCalls, 1);
    assert.equal(store.deleteCalls, 0);
    assert.equal(store.candidate?.sheetRowId, "Hackathons!A5:X5");
  });

  it("maps already_synced append to already_present", async () => {
    const store: FakeStore = {
      candidate: baseCandidate({
        sheetRowId: "Hackathons!A3:X3",
        sheetAppendedAt: "2026-07-10T00:00:00.000Z",
      }),
      actions: [],
      findResult: null,
      deleteCalls: 0,
      findCalls: 0,
      deleteShouldFail: false,
      clearShouldFail: false,
      appendResults: [
        {
          status: "already_synced",
          candidateId: CANDIDATE_ID,
          rowId: "Hackathons!A3:X3",
        },
      ],
      appendCalls: 0,
    };
    const deps = createReconcileDeps(store);

    const result = await reconcileCandidateSheetState(CANDIDATE_ID, deps);

    assert.equal(result.status, "already_present");
    assert.equal(result.direction, "ensure_present");
  });

  it("reject after approve deletes the sheet row", async () => {
    const store: FakeStore = {
      candidate: baseCandidate({
        status: "REJECTED",
        sheetRowId: "Hackathons!A5:X5",
        sheetAppendedAt: "2026-07-11T12:00:00.000Z",
      }),
      actions: [],
      findResult: { rowNumber: 5, range: "Hackathons!X5" },
      deleteCalls: 0,
      findCalls: 0,
      deleteShouldFail: false,
      clearShouldFail: false,
      appendResults: [],
      appendCalls: 0,
    };
    const deps = createReconcileDeps(store);

    const result = await reconcileCandidateSheetState(CANDIDATE_ID, deps);

    assert.equal(result.status, "deleted");
    assert.equal(result.direction, "ensure_absent");
    assert.equal(result.rowNumber, 5);
    assert.equal(store.deleteCalls, 1);
    assert.equal(store.findCalls, 1);
    assert.equal(store.candidate?.sheetRowId, null);
    assert.equal(store.candidate?.sheetAppendedAt, null);
    assert.equal(store.actions[0]?.action, "SHEET_DELETE");
    assert.equal((store.actions[0]?.metadata as { ok?: boolean }).ok, true);
  });

  it("restore after approve deletes the sheet row", async () => {
    const store: FakeStore = {
      candidate: baseCandidate({
        status: "NEW",
        sheetRowId: "Hackathons!A4:X4",
        sheetAppendedAt: "2026-07-11T12:00:00.000Z",
      }),
      actions: [],
      findResult: { rowNumber: 4, range: "Hackathons!X4" },
      deleteCalls: 0,
      findCalls: 0,
      deleteShouldFail: false,
      clearShouldFail: false,
      appendResults: [],
      appendCalls: 0,
    };
    const deps = createReconcileDeps(store);

    const result = await reconcileCandidateSheetState(CANDIDATE_ID, deps);

    assert.equal(result.status, "deleted");
    assert.equal(store.deleteCalls, 1);
    assert.equal(store.candidate?.sheetRowId, null);
  });

  it("save after approve deletes the sheet row", async () => {
    const store: FakeStore = {
      candidate: baseCandidate({
        status: "SAVED_FOR_LATER",
        sheetRowId: "Hackathons!A6:X6",
        sheetAppendedAt: "2026-07-11T12:00:00.000Z",
      }),
      actions: [],
      findResult: { rowNumber: 6, range: "Hackathons!X6" },
      deleteCalls: 0,
      findCalls: 0,
      deleteShouldFail: false,
      clearShouldFail: false,
      appendResults: [],
      appendCalls: 0,
    };
    const deps = createReconcileDeps(store);

    const result = await reconcileCandidateSheetState(CANDIDATE_ID, deps);

    assert.equal(result.status, "deleted");
    assert.equal(store.deleteCalls, 1);
    assert.equal(store.candidate?.sheetRowId, null);
  });

  it("reapprove creates one row after a prior delete", async () => {
    const store: FakeStore = {
      candidate: baseCandidate({
        status: "REJECTED",
        sheetRowId: "Hackathons!A5:X5",
        sheetAppendedAt: "2026-07-11T12:00:00.000Z",
      }),
      actions: [],
      findResult: { rowNumber: 5, range: "Hackathons!X5" },
      deleteCalls: 0,
      findCalls: 0,
      deleteShouldFail: false,
      clearShouldFail: false,
      appendResults: [],
      appendCalls: 0,
    };
    const deps = createReconcileDeps(store);

    const deleted = await reconcileCandidateSheetState(CANDIDATE_ID, deps);
    assert.equal(deleted.status, "deleted");
    assert.equal(store.candidate?.sheetRowId, null);

    store.candidate = baseCandidate({
      status: "APPROVED",
      sheetRowId: null,
      sheetAppendedAt: null,
    });

    const appended = await reconcileCandidateSheetState(CANDIDATE_ID, deps);
    assert.equal(appended.status, "appended");
    assert.equal(store.appendCalls, 1);
    assert.equal(store.candidate?.sheetRowId, "Hackathons!A5:X5");
  });

  it("stale sheet_row_id still finds the correct row by Candidate ID", async () => {
    const store: FakeStore = {
      candidate: baseCandidate({
        status: "REJECTED",
        // Stale A1 range pointing at a different row than live lookup.
        sheetRowId: "Hackathons!A99:X99",
        sheetAppendedAt: "2026-07-10T00:00:00.000Z",
      }),
      actions: [],
      findResult: { rowNumber: 3, range: "Hackathons!X3" },
      deleteCalls: 0,
      findCalls: 0,
      deleteShouldFail: false,
      clearShouldFail: false,
      appendResults: [],
      appendCalls: 0,
    };
    const deps = createReconcileDeps(store);

    const result = await reconcileCandidateSheetState(CANDIDATE_ID, deps);

    assert.equal(result.status, "deleted");
    assert.equal(result.rowNumber, 3);
    assert.equal(store.findCalls, 1);
    assert.equal(store.deleteCalls, 1);
    assert.notEqual(result.rowId, "Hackathons!A99:X99");
    assert.equal(result.rowId, "Hackathons!X3");
  });

  it("returns already_absent when no sheet row exists", async () => {
    const store: FakeStore = {
      candidate: baseCandidate({
        status: "REJECTED",
        sheetRowId: null,
        sheetAppendedAt: null,
      }),
      actions: [],
      findResult: null,
      deleteCalls: 0,
      findCalls: 0,
      deleteShouldFail: false,
      clearShouldFail: false,
      appendResults: [],
      appendCalls: 0,
    };
    const deps = createReconcileDeps(store);

    const result = await reconcileCandidateSheetState(CANDIDATE_ID, deps);

    assert.equal(result.status, "already_absent");
    assert.equal(store.deleteCalls, 0);
    assert.equal(store.findCalls, 1);
    assert.equal(store.actions.length, 0);
  });

  it("clears stale metadata when row is already absent", async () => {
    const store: FakeStore = {
      candidate: baseCandidate({
        status: "REJECTED",
        sheetRowId: "Hackathons!A5:X5",
        sheetAppendedAt: "2026-07-11T12:00:00.000Z",
      }),
      actions: [],
      findResult: null,
      deleteCalls: 0,
      findCalls: 0,
      deleteShouldFail: false,
      clearShouldFail: false,
      appendResults: [],
      appendCalls: 0,
    };
    const deps = createReconcileDeps(store);

    const result = await reconcileCandidateSheetState(CANDIDATE_ID, deps);

    assert.equal(result.status, "already_absent");
    assert.equal(result.metadataCleared, true);
    assert.equal(store.candidate?.sheetRowId, null);
    assert.equal(store.deleteCalls, 0);
  });

  it("returns failed on Google API deletion failure without clearing metadata", async () => {
    const store: FakeStore = {
      candidate: baseCandidate({
        status: "REJECTED",
        sheetRowId: "Hackathons!A5:X5",
        sheetAppendedAt: "2026-07-11T12:00:00.000Z",
      }),
      actions: [],
      findResult: { rowNumber: 5, range: "Hackathons!X5" },
      deleteCalls: 0,
      findCalls: 0,
      deleteShouldFail: true,
      clearShouldFail: false,
      appendResults: [],
      appendCalls: 0,
    };
    const deps = createReconcileDeps(store);

    const result = await reconcileCandidateSheetState(CANDIDATE_ID, deps);

    assert.equal(result.status, "failed");
    assert.match(result.message ?? "", /Google API delete failed/);
    assert.equal(store.candidate?.sheetRowId, "Hackathons!A5:X5");
    assert.equal(store.deleteCalls, 1);
    assert.equal(store.actions[0]?.action, "SHEET_DELETE");
    assert.equal((store.actions[0]?.metadata as { ok?: boolean }).ok, false);
  });

  it("returns failed when metadata clear fails after delete", async () => {
    const store: FakeStore = {
      candidate: baseCandidate({
        status: "REJECTED",
        sheetRowId: "Hackathons!A5:X5",
        sheetAppendedAt: "2026-07-11T12:00:00.000Z",
      }),
      actions: [],
      findResult: { rowNumber: 5, range: "Hackathons!X5" },
      deleteCalls: 0,
      findCalls: 0,
      deleteShouldFail: false,
      clearShouldFail: true,
      appendResults: [],
      appendCalls: 0,
    };
    const deps = createReconcileDeps(store);

    const result = await reconcileCandidateSheetState(CANDIDATE_ID, deps);

    assert.equal(result.status, "failed");
    assert.match(result.message ?? "", /metadata clear failed/);
    assert.equal(store.deleteCalls, 1);
    assert.equal(store.candidate?.sheetRowId, "Hackathons!A5:X5");
    assert.equal(
      (store.actions[0]?.metadata as { deleteSucceeded?: boolean }).deleteSucceeded,
      true,
    );
  });

  it("mock mode clears metadata without calling Google delete", async () => {
    const store: FakeStore = {
      candidate: baseCandidate({
        status: "REJECTED",
        sheetRowId: `mock-row:${CANDIDATE_ID}`,
        sheetAppendedAt: "2026-07-11T12:00:00.000Z",
      }),
      actions: [],
      findResult: { rowNumber: 5, range: "Hackathons!X5" },
      deleteCalls: 0,
      findCalls: 0,
      deleteShouldFail: false,
      clearShouldFail: false,
      appendResults: [],
      appendCalls: 0,
    };
    const deps = createReconcileDeps(store, {
      isMockCandidatesEnabled: () => true,
    });

    const result = await reconcileCandidateSheetState(CANDIDATE_ID, deps);

    assert.equal(result.status, "mock_cleared");
    assert.equal(result.metadataCleared, true);
    assert.equal(store.deleteCalls, 0);
    assert.equal(store.findCalls, 0);
    assert.equal(store.candidate?.sheetRowId, null);
    assert.equal(store.actions[0]?.action, "SHEET_DELETE");
    assert.deepEqual(store.actions[0]?.metadata, {
      ok: true,
      mock: true,
    });
  });
});
