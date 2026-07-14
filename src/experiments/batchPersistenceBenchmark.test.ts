import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CandidateRow, PersistencePlan } from "@/discovery/persistence/persistencePlan";
import {
  assertWriteAllowed,
  candidateParity,
  evidenceExistenceDeltas,
  parseArgs,
  verifyPlanSafety,
} from "@/experiments/batchPersistenceBenchmark";

const BENCHMARK_BRANCH = "experiment/phase-3a-2-live-batch-benchmark";

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

function candidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: "candidate-a",
    status: "NEW",
    score: 1,
    name: "Benchmark Fixture",
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
    fingerprint: "fp-a",
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
    ...overrides,
  };
}

describe("batch persistence benchmark guards", () => {
  it("requires an explicit persisted run selector", () => {
    assert.throws(() => parseArgs(["node", "script"]), /Provide --run-id/);
    assert.deepEqual(parseArgs(["node", "script", "--run-id=run-1"]).runId, "run-1");
    assert.equal(
      parseArgs(["node", "script", "--select-latest-bounded"]).selectLatestBounded,
      true,
    );
  });

  it("requires both live-write confirmation flags", () => {
    assert.throws(
      () =>
        assertWriteAllowed(
          {
            selectLatestBounded: true,
            writeExperiment: true,
            confirmBatchPersistenceExperiment: false,
          },
          { branch: BENCHMARK_BRANCH, env: {} },
        ),
      /both confirmation flags/,
    );
  });

  it("refuses live writes on the wrong branch and production-like environments", () => {
    const args = {
      selectLatestBounded: true,
      writeExperiment: true,
      confirmBatchPersistenceExperiment: true,
    };

    assert.throws(
      () => assertWriteAllowed(args, { branch: "main", env: {} }),
      /Refusing live batch write on branch main/,
    );
    assert.throws(
      () => assertWriteAllowed(args, { branch: BENCHMARK_BRANCH, env: { NODE_ENV: "production" } }),
      /production-like/,
    );
    assert.doesNotThrow(() => assertWriteAllowed(args, { branch: BENCHMARK_BRANCH, env: {} }));
  });

  it("refuses unsafe persistence plans", () => {
    assert.throws(
      () =>
        verifyPlanSafety(
          emptyPlan({
            candidateCreates: [
              {
                fingerprint: "fp-new",
                sourceInput: { fingerprint: "fp-new", name: "New", source: "mlh" },
                row: { fingerprint: "fp-new", name: "New", source: "mlh" },
              },
            ],
          }),
        ),
      /candidate creates/,
    );

    assert.throws(
      () =>
        verifyPlanSafety(
          emptyPlan({
            candidateUpdates: [
              {
                fingerprint: "fp-a",
                id: "candidate-a",
                existing: candidate(),
                payload: { status: "APPROVED" },
                sourceInput: { fingerprint: "fp-a", name: "Benchmark Fixture", source: "mlh" },
              },
            ],
          }),
        ),
      /Unsafe candidate update/,
    );

    assert.throws(
      () =>
        verifyPlanSafety(
          emptyPlan({
            actionsToCreate: [
              {
                candidateFingerprint: "fp-a",
                candidateId: "candidate-a",
                action: {
                  action: "APPROVE",
                  previousStatus: "NEW",
                  newStatus: "APPROVED",
                },
              },
            ],
          }),
        ),
      /Unsafe candidate action/,
    );
  });

  it("detects protected candidate field drift during replay verification", () => {
    assert.equal(candidateParity([candidate()], [candidate()]), "pass");
    assert.equal(candidateParity([candidate()], [candidate({ status: "APPROVED" })]), "fail");
    assert.equal(candidateParity([candidate()], [candidate({ sheet_row_id: "42" })]), "fail");
  });

  it("counts missing and unexpected evidence rows from final-state diffs", () => {
    const deltas = evidenceExistenceDeltas({
      parity: "fail",
      seenCountParity: "pass",
      lastSeenAtParity: "pass",
      agentRunParity: "pass",
      v1OperationCount: 2,
      v1DistinctIdentities: 2,
      batchMutationCount: 2,
      duplicateObservationCount: 0,
      duplicateIdentityHashes: [],
      differences: [
        {
          identityHash: "missing",
          field: "existence",
          expected: "present",
          actual: "missing",
        },
        {
          identityHash: "unexpected",
          field: "existence",
          expected: "missing",
          actual: "present",
        },
      ],
    });

    assert.deepEqual(deltas, { missingRows: 1, unexpectedRows: 1 });
  });
});
