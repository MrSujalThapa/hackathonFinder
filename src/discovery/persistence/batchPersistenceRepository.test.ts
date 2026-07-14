import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BatchPersistenceWriteError,
  BatchPersistenceRepository,
  type BatchPersistenceAdapter,
} from "@/discovery/persistence/batchPersistenceRepository";
import type { CandidateRow, EvidenceRow, PersistencePlan } from "@/discovery/persistence/persistencePlan";

function candidate(id: string, fingerprint = id): CandidateRow {
  return {
    id,
    status: "NEW",
    score: 1,
    name: id,
    source: "mlh",
    official_url: null,
    apply_url: null,
    social_url: null,
    start_date: null,
    end_date: null,
    deadline: null,
    location: null,
    mode: null,
    city: null,
    country: null,
    prize: null,
    themes: [],
    eligibility: null,
    description: null,
    summary: null,
    why_match: [],
    red_flags: [],
    fingerprint,
    source_ids: {},
    sheet_row_id: null,
    sheet_appended_at: null,
    found_at: "2026-07-14T00:00:00.000Z",
    last_verified: "2026-07-14T00:00:00.000Z",
    approved_at: null,
    rejected_at: null,
    saved_at: null,
    created_at: "2026-07-14T00:00:00.000Z",
    updated_at: "2026-07-14T00:00:00.000Z",
  };
}

function evidence(id: string, candidateId = "c1"): EvidenceRow {
  return {
    id,
    candidate_id: candidateId,
    type: "official_page",
    url: null,
    title: null,
    snippet: null,
    raw: {},
    found_at: "2026-07-14T00:00:00.000Z",
    created_at: "2026-07-14T00:00:00.000Z",
    url_key: "",
    first_seen_at: "2026-07-14T00:00:00.000Z",
    last_seen_at: "2026-07-14T00:00:00.000Z",
    seen_count: 1,
    agent_run_id: null,
  };
}

function emptyPlan(overrides: Partial<PersistencePlan> = {}): PersistencePlan {
  return {
    candidateCreates: [],
    candidateUpdates: [],
    candidateUnchanged: [],
    evidenceCreates: [],
    evidenceUpdates: [],
    evidenceUnchanged: [],
    actionsToCreate: [],
    diagnostics: {
      incomingCandidates: 0,
      uniqueFingerprints: 0,
      duplicateIncomingCandidates: 0,
      incomingEvidence: 0,
      uniqueEvidence: 0,
      duplicateEvidenceObservations: 0,
    },
    ...overrides,
  };
}

function adapter(overrides: Partial<BatchPersistenceAdapter> = {}): BatchPersistenceAdapter {
  return {
    async selectCandidatesByFingerprints(fingerprints) {
      return fingerprints.map((fingerprint) => candidate(`id-${fingerprint}`, fingerprint));
    },
    async insertCandidates(rows) {
      return rows.map((row, index) => candidate(`created-${index}`, row.fingerprint));
    },
    async upsertCandidateUpdates(rows) {
      return rows.map((row) => candidate(row.id));
    },
    async selectEvidenceByCandidateIds(ids) {
      return ids.map((id) => evidence(`e-${id}`, id));
    },
    async insertEvidence(rows) {
      return rows.map((row, index) => evidence(`created-e-${index}`, row.candidate_id));
    },
    async upsertEvidenceUpdates(rows) {
      return rows.map((row) => evidence(row.id));
    },
    async insertActions(rows) {
      return rows.map((row, index) => ({ ...row, id: `action-${index}` }));
    },
    ...overrides,
  };
}

describe("BatchPersistenceRepository", () => {
  it("chunks candidate lookup", async () => {
    const calls: number[] = [];
    const repo = new BatchPersistenceRepository(
      adapter({
        async selectCandidatesByFingerprints(fingerprints) {
          calls.push(fingerprints.length);
          return [];
        },
      }),
      { chunkSizes: { candidateLookup: 2 } },
    );

    const result = await repo.fetchCandidatesByFingerprints(["a", "b", "c", "d", "e"]);

    assert.deepEqual(calls, [2, 2, 1]);
    assert.equal(result.metrics.databaseCalls, 3);
  });

  it("chunks candidate inserts and updates", async () => {
    const inserts: number[] = [];
    const updates: number[] = [];
    const repo = new BatchPersistenceRepository(
      adapter({
        async insertCandidates(rows) {
          inserts.push(rows.length);
          return [];
        },
        async upsertCandidateUpdates(rows) {
          updates.push(rows.length);
          return [];
        },
      }),
      { chunkSizes: { candidateWrite: 2 } },
    );
    const plan = emptyPlan({
      candidateCreates: [0, 1, 2].map((index) => ({
        fingerprint: `new-${index}`,
        sourceInput: {
          fingerprint: `new-${index}`,
          name: `new-${index}`,
          source: "mlh",
        },
        row: { fingerprint: `new-${index}`, name: `new-${index}`, source: "mlh" },
      })),
      candidateUpdates: [0, 1, 2].map((index) => ({
        fingerprint: `old-${index}`,
        id: `id-${index}`,
        existing: candidate(`id-${index}`, `old-${index}`),
        payload: { score: index },
        sourceInput: {
          fingerprint: `old-${index}`,
          name: `old-${index}`,
          source: "mlh",
        },
      })),
    });

    const result = await repo.writePlan(plan);

    assert.deepEqual(inserts, [2, 1]);
    assert.deepEqual(updates, [2, 1]);
    assert.equal(result.metrics.databaseCalls, 4);
  });

  it("chunks evidence lookup and writes", async () => {
    const lookup: number[] = [];
    const writes: number[] = [];
    const repo = new BatchPersistenceRepository(
      adapter({
        async selectEvidenceByCandidateIds(ids) {
          lookup.push(ids.length);
          return [];
        },
        async insertEvidence(rows) {
          writes.push(rows.length);
          return [];
        },
      }),
      { chunkSizes: { evidenceLookup: 2, evidenceWrite: 2 } },
    );

    await repo.fetchEvidenceByCandidateIds(["a", "b", "c"]);
    await repo.writePlan(
      emptyPlan({
        evidenceCreates: [0, 1, 2].map((index) => ({
          candidateFingerprint: `fp-${index}`,
          candidateId: `c-${index}`,
          type: "official_page",
          urlKey: "",
          row: {
            candidate_id: `c-${index}`,
            type: "official_page",
            url_key: "",
          },
          observationCount: 1,
          seenCountIncrement: 1,
        })),
      }),
    );

    assert.deepEqual(lookup, [2, 1]);
    assert.deepEqual(writes, [2, 1]);
  });

  it("splits failed chunks and terminates at max depth", async () => {
    let attempts = 0;
    const repo = new BatchPersistenceRepository(
      adapter({
        async insertCandidates(rows) {
          attempts += 1;
          if (rows.length > 1) throw new Error("payload too large");
          return [];
        },
      }),
      { chunkSizes: { candidateWrite: 4 }, maxSplitDepth: 2 },
    );

    const result = await repo.writePlan(
      emptyPlan({
        candidateCreates: [0, 1, 2, 3].map((index) => ({
          fingerprint: `new-${index}`,
          sourceInput: {
            fingerprint: `new-${index}`,
            name: `new-${index}`,
            source: "mlh",
          },
          row: { fingerprint: `new-${index}`, name: `new-${index}`, source: "mlh" },
        })),
      }),
    );

    assert.equal(attempts, 7);
    assert.equal(result.metrics.retries, 3);
    assert.equal(result.metrics.splitBatches, 3);
  });

  it("reports malformed singleton failure without infinite retry", async () => {
    const repo = new BatchPersistenceRepository(
      adapter({
        async insertCandidates() {
          throw new Error("bad row");
        },
      }),
      { chunkSizes: { candidateWrite: 2 }, maxSplitDepth: 4 },
    );

    await assert.rejects(
      () =>
        repo.writePlan(
          emptyPlan({
            candidateCreates: [
              {
                fingerprint: "bad",
                sourceInput: { fingerprint: "bad", name: "bad", source: "mlh" },
                row: { fingerprint: "bad", name: "bad", source: "mlh" },
              },
            ],
          }),
        ),
      /bad row/,
    );
  });

  it("maps returned candidate IDs from adapter results", async () => {
    const repo = new BatchPersistenceRepository(adapter(), {
      chunkSizes: { candidateWrite: 10 },
    });

    const result = await repo.writePlan(
      emptyPlan({
        candidateCreates: [
          {
            fingerprint: "fp",
            sourceInput: { fingerprint: "fp", name: "Name", source: "mlh" },
            row: { fingerprint: "fp", name: "Name", source: "mlh" },
          },
        ],
      }),
    );

    assert.equal(result.createdCandidates[0]?.fingerprint, "fp");
  });

  it("maps newly created candidate IDs into evidence creates", async () => {
    const evidenceCandidateIds: string[] = [];
    const repo = new BatchPersistenceRepository(
      adapter({
        async insertCandidates(rows) {
          return rows.map((row) => candidate(`created-${row.fingerprint}`, row.fingerprint));
        },
        async insertEvidence(rows) {
          evidenceCandidateIds.push(...rows.map((row) => row.candidate_id));
          return rows.map((row, index) => evidence(`created-e-${index}`, row.candidate_id));
        },
      }),
    );

    await repo.writePlan(
      emptyPlan({
        candidateCreates: [
          {
            fingerprint: "fp-new",
            sourceInput: { fingerprint: "fp-new", name: "New", source: "mlh" },
            row: { fingerprint: "fp-new", name: "New", source: "mlh" },
          },
        ],
        evidenceCreates: [
          {
            candidateFingerprint: "fp-new",
            type: "official_page",
            urlKey: "https://example.test/",
            row: {
              candidate_id: "__pending_candidate_id__",
              type: "official_page",
              url_key: "https://example.test/",
            },
            observationCount: 1,
            seenCountIncrement: 1,
          },
        ],
      }),
    );

    assert.deepEqual(evidenceCandidateIds, ["created-fp-new"]);
  });

  it("reports partial progress without retrying through V1 when evidence writes fail", async () => {
    const repo = new BatchPersistenceRepository(
      adapter({
        async insertCandidates(rows) {
          return rows.map((row) => candidate(`created-${row.fingerprint}`, row.fingerprint));
        },
        async insertEvidence() {
          throw new Error("evidence failed");
        },
      }),
    );

    await assert.rejects(
      () =>
        repo.writePlan(
          emptyPlan({
            candidateCreates: [
              {
                fingerprint: "fp-new",
                sourceInput: { fingerprint: "fp-new", name: "New", source: "mlh" },
                row: { fingerprint: "fp-new", name: "New", source: "mlh" },
              },
            ],
            evidenceCreates: [
              {
                candidateFingerprint: "fp-new",
                type: "official_page",
                urlKey: "https://example.test/",
                row: {
                  candidate_id: "__pending_candidate_id__",
                  type: "official_page",
                  url_key: "https://example.test/",
                },
                observationCount: 1,
                seenCountIncrement: 1,
              },
            ],
          }),
        ),
      (error) => {
        assert.ok(error instanceof BatchPersistenceWriteError);
        assert.equal(error.progress.writesStarted, true);
        assert.equal(error.progress.candidateWritesCompleted, true);
        assert.equal(error.progress.evidenceWritesCompleted, false);
        assert.equal(error.progress.actionWritesCompleted, false);
        assert.equal(error.partialResult.createdCandidates.length, 1);
        return true;
      },
    );
  });
});
