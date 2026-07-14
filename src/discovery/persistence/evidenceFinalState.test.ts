import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AddEvidenceInput, UpsertCandidateInput } from "@/core/candidates/types";
import type { CandidateRow, EvidenceRow, IncomingCandidateWrite, PersistencePlan } from "@/discovery/persistence/persistencePlan";
import {
  compareEvidenceFinalStates,
  simulateBatchEvidenceFinalState,
  simulateV1EvidenceFinalState,
} from "@/discovery/persistence/evidenceFinalState";
import { normalizeEvidenceUrlKey } from "@/lib/http/evidenceUrl";

const NOW = "2026-07-14T12:00:00.000Z";
const LATER = "2026-07-14T12:05:00.000Z";

function candidateInput(overrides: Partial<UpsertCandidateInput> = {}): UpsertCandidateInput {
  return {
    fingerprint: "fp-safe",
    name: "Safe Fixture",
    source: "mlh",
    ...overrides,
  };
}

function candidateRow(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: "candidate-safe",
    status: "NEW",
    score: 1,
    name: "Safe Fixture",
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
    fingerprint: "fp-safe",
    source_ids: {},
    sheet_row_id: null,
    sheet_appended_at: null,
    found_at: NOW,
    last_verified: NOW,
    approved_at: null,
    rejected_at: null,
    saved_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function evidence(overrides: Partial<AddEvidenceInput> = {}): AddEvidenceInput {
  return {
    type: "official_page",
    url: "https://example.test/event?utm_source=noise#top",
    title: "First",
    snippet: "One",
    raw: { n: 1 },
    foundAt: NOW,
    agentRunId: "run-a",
    ...overrides,
  };
}

function evidenceRow(overrides: Partial<EvidenceRow> = {}): EvidenceRow {
  return {
    id: "evidence-safe",
    candidate_id: "candidate-safe",
    type: "official_page",
    url: "https://example.test/event",
    url_key: normalizeEvidenceUrlKey("https://example.test/event"),
    title: "Existing",
    snippet: "Existing",
    raw: { existing: true },
    found_at: NOW,
    created_at: NOW,
    first_seen_at: NOW,
    last_seen_at: NOW,
    seen_count: 5,
    agent_run_id: "run-old",
    ...overrides,
  };
}

function write(items: AddEvidenceInput[], candidate = candidateInput()): IncomingCandidateWrite {
  return { candidate, evidence: items };
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
      incomingCandidates: 1,
      uniqueFingerprints: 1,
      duplicateIncomingCandidates: 0,
      incomingEvidence: 0,
      uniqueEvidence: 0,
      duplicateEvidenceObservations: 0,
    },
    ...overrides,
  };
}

describe("evidence final-state simulation", () => {
  it("models insert followed by a duplicate observation in one run", () => {
    const v1 = simulateV1EvidenceFinalState(
      [
        write([
          evidence({ title: "First", foundAt: NOW, agentRunId: "run-a" }),
          evidence({ title: "Second", foundAt: LATER, agentRunId: "run-b" }),
        ]),
      ],
      [],
      [],
      { now: NOW },
    );
    const state = [...v1.states.values()][0]!;

    assert.equal(v1.operationCount, 2);
    assert.equal(v1.distinctObservedIdentityCount, 1);
    assert.equal(v1.duplicateObservationCount, 1);
    assert.equal(state.row.seenCount, 2);
    assert.equal(state.row.title, "Second");
    assert.equal(state.row.lastSeenAt, LATER);
    assert.equal(state.row.agentRunId, "run-b");
  });

  it("models existing evidence observed twice as two seen-count increments", () => {
    const v1 = simulateV1EvidenceFinalState(
      [write([evidence({ foundAt: NOW }), evidence({ foundAt: LATER })])],
      [candidateRow()],
      [evidenceRow()],
      { now: NOW },
    );
    const state = [...v1.states.values()][0]!;

    assert.equal(v1.operationCount, 2);
    assert.equal(state.row.seenCount, 7);
    assert.equal(state.row.lastSeenAt, LATER);
  });

  it("treats raw URL variants with the same normalized URL as one identity", () => {
    const v1 = simulateV1EvidenceFinalState(
      [
        write([
          evidence({ url: "https://www.example.test/event/?utm_source=a" }),
          evidence({ url: "https://example.test/event#section" }),
        ]),
      ],
      [],
      [],
      { now: NOW },
    );

    assert.equal(v1.states.size, 1);
    assert.equal(v1.operationCount, 2);
  });

  it("keeps same URL with different evidence types distinct", () => {
    const v1 = simulateV1EvidenceFinalState(
      [
        write([
          evidence({ type: "official_page" }),
          evidence({ type: "apply_page" }),
        ]),
      ],
      [],
      [],
      { now: NOW },
    );

    assert.equal(v1.states.size, 2);
    assert.equal(v1.duplicateObservationCount, 0);
  });

  it("keeps same evidence URL for different candidates distinct", () => {
    const v1 = simulateV1EvidenceFinalState(
      [
        write([evidence()], candidateInput({ fingerprint: "fp-a", name: "A" })),
        write([evidence()], candidateInput({ fingerprint: "fp-b", name: "B" })),
      ],
      [],
      [],
      { now: NOW },
    );

    assert.equal(v1.states.size, 2);
  });

  it("allows semantic parity when batch collapses redundant V1 calls with multiplicity", () => {
    const v1 = simulateV1EvidenceFinalState(
      [write([evidence({ foundAt: NOW }), evidence({ foundAt: LATER })])],
      [candidateRow()],
      [evidenceRow()],
      { now: NOW },
    );
    const plan = emptyPlan({
      evidenceUpdates: [
        {
          candidateFingerprint: "fp-safe",
          candidateId: "candidate-safe",
          type: "official_page",
          urlKey: normalizeEvidenceUrlKey("https://example.test/event"),
          id: "evidence-safe",
          payload: {
            title: "First",
            snippet: "One",
            raw: { n: 1 },
            url: "https://example.test/event?utm_source=noise#top",
            seen_count: 7,
            last_seen_at: LATER,
            agent_run_id: "run-a",
          },
          observationCount: 2,
          seenCountIncrement: 2,
        },
      ],
    });

    const comparison = compareEvidenceFinalStates({
      v1,
      batch: simulateBatchEvidenceFinalState(plan, [evidenceRow()]),
      batchMutationCount: 1,
    });

    assert.equal(comparison.parity, "pass");
    assert.equal(comparison.v1OperationCount, 2);
    assert.equal(comparison.batchMutationCount, 1);
  });

  it("detects final-state seen-count mismatches", () => {
    const v1 = simulateV1EvidenceFinalState(
      [write([evidence(), evidence()])],
      [candidateRow()],
      [evidenceRow()],
      { now: NOW },
    );
    const plan = emptyPlan({
      evidenceUpdates: [
        {
          candidateFingerprint: "fp-safe",
          candidateId: "candidate-safe",
          type: "official_page",
          urlKey: normalizeEvidenceUrlKey("https://example.test/event"),
          id: "evidence-safe",
          payload: {
            seen_count: 6,
            last_seen_at: NOW,
            agent_run_id: "run-a",
          },
          observationCount: 1,
          seenCountIncrement: 1,
        },
      ],
    });

    const comparison = compareEvidenceFinalStates({
      v1,
      batch: simulateBatchEvidenceFinalState(plan, [evidenceRow()]),
      batchMutationCount: 1,
    });

    assert.equal(comparison.parity, "fail");
    assert.equal(comparison.seenCountParity, "fail");
    assert.ok(comparison.differences.every((diff) => !String(diff.identityHash).includes("example")));
  });
});
