import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { comparePersistenceShadow, formatPersistenceShadowSummary } from "@/discovery/persistence/comparePersistenceResults";
import {
  BatchPersistenceRepository,
  type BatchPersistenceAdapter,
} from "@/discovery/persistence/batchPersistenceRepository";
import {
  acceptedCandidatesToWriteSet,
  preparePersistenceShadow,
} from "@/discovery/persistence/persistenceShadow";
import type { AcceptedCandidate } from "@/core/discovery/types";
import type { CandidateRow } from "@/discovery/persistence/persistencePlan";

const NOW = new Date("2026-07-14T12:00:00.000Z");

function candidateRow(fingerprint: string): CandidateRow {
  return {
    id: "candidate-1",
    status: "APPROVED",
    score: 10,
    name: "Toronto Hack",
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
    found_at: NOW.toISOString(),
    last_verified: NOW.toISOString(),
    approved_at: NOW.toISOString(),
    rejected_at: null,
    saved_at: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  };
}

function accepted(): AcceptedCandidate {
  return {
    event: {
      name: "Toronto Hack",
      source: "mlh",
      officialUrl: "https://toronto.example",
      applyUrl: "https://toronto.example/apply",
      startDate: "2026-09-01",
      deadline: "2026-08-01",
      location: "Toronto",
      mode: "in-person",
      city: "Toronto",
      country: "Canada",
      themes: ["AI"],
      sourceIds: { mlh: "toronto" },
      evidence: [
        {
          type: "official_page",
          url: "https://toronto.example",
          title: "Toronto Hack",
        },
      ],
    },
    score: {
      score: 90,
      whyMatch: ["Toronto"],
      redFlags: [],
      rejected: false,
    },
    fingerprint: "",
    status: "NEW",
  };
}

function noWriteAdapter(overrides: Partial<BatchPersistenceAdapter> = {}): BatchPersistenceAdapter {
  return {
    async selectCandidatesByFingerprints() {
      return [];
    },
    async selectEvidenceByCandidateIds() {
      return [];
    },
    async insertCandidates() {
      throw new Error("write called");
    },
    async upsertCandidateUpdates() {
      throw new Error("write called");
    },
    async insertEvidence() {
      throw new Error("write called");
    },
    async upsertEvidenceUpdates() {
      throw new Error("write called");
    },
    async insertActions() {
      throw new Error("write called");
    },
    ...overrides,
  };
}

describe("persistence shadow comparison", () => {
  it("performs no writes while preparing a shadow plan", async () => {
    const repo = new BatchPersistenceRepository(noWriteAdapter(), {
      chunkSizes: { candidateLookup: 10, evidenceLookup: 10 },
    });

    const state = await preparePersistenceShadow([accepted()], {
      now: NOW,
      agentRunId: "run-1",
      repository: repo,
    });

    assert.equal(state.plan.candidateCreates.length, 1);
    assert.equal(state.plan.evidenceCreates.length, 1);
  });

  it("keeps V1 summary authoritative and reports matching parity", () => {
    const writeSet = acceptedCandidatesToWriteSet([accepted()], {
      now: NOW,
      agentRunId: "run-1",
    });
    const plan = {
      candidateCreates: [
        {
          fingerprint: writeSet[0]!.candidate.fingerprint,
          row: { fingerprint: writeSet[0]!.candidate.fingerprint, name: "Toronto Hack", source: "mlh" },
          sourceInput: writeSet[0]!.candidate,
        },
      ],
      candidateUpdates: [],
      candidateUnchanged: [],
      evidenceCreates: [
        {
          candidateFingerprint: writeSet[0]!.candidate.fingerprint,
          type: "official_page" as const,
          urlKey: "https://toronto.example/",
          row: {
            candidate_id: "__pending_candidate_id__",
            type: "official_page" as const,
            url_key: "https://toronto.example/",
          },
          observationCount: 1,
          seenCountIncrement: 1,
        },
      ],
      evidenceUpdates: [],
      evidenceUnchanged: [],
      actionsToCreate: [],
      diagnostics: {
        incomingCandidates: 1,
        uniqueFingerprints: 1,
        duplicateIncomingCandidates: 0,
        incomingEvidence: 1,
        uniqueEvidence: 1,
        duplicateEvidenceObservations: 0,
      },
    };

    const result = comparePersistenceShadow({
      plan,
      summary: { created: 1, updated: 0, evidenceWritten: 1 },
      metrics: { databaseCalls: 1, chunks: { candidateLookup: 1 }, retries: 0, splitBatches: 0 },
      estimatedBatchDatabaseCalls: 3,
      timing: { candidateLookupMs: 1, evidenceLookupMs: 1, planningMs: 1, totalMs: 3 },
    });

    assert.equal(result.summary.candidateParity, "pass");
    assert.equal(result.summary.evidenceParity, "pass");
    assert.equal(result.summary.batchWritesEnabled, false);
  });

  it("detects field/status/evidence/action mismatches with safe diagnostics", () => {
    const existing = candidateRow("fp");
    const plan = {
      candidateCreates: [],
      candidateUpdates: [
        {
          fingerprint: "fp",
          id: "candidate-1",
          existing,
          payload: { status: "NEW" as const },
          sourceInput: { fingerprint: "fp", name: "Toronto Hack", source: "mlh" },
        },
      ],
      candidateUnchanged: [],
      evidenceCreates: [],
      evidenceUpdates: [],
      evidenceUnchanged: [],
      actionsToCreate: [],
      diagnostics: {
        incomingCandidates: 1,
        uniqueFingerprints: 1,
        duplicateIncomingCandidates: 0,
        incomingEvidence: 1,
        uniqueEvidence: 1,
        duplicateEvidenceObservations: 0,
      },
    };

    const result = comparePersistenceShadow({
      plan,
      summary: { created: 0, updated: 0, evidenceWritten: 1 },
      metrics: { databaseCalls: 2, chunks: {}, retries: 0, splitBatches: 0 },
      estimatedBatchDatabaseCalls: 5,
      timing: { candidateLookupMs: 1, evidenceLookupMs: 1, planningMs: 1, totalMs: 3 },
    });
    const terminal = formatPersistenceShadowSummary(result.summary).join("\n");

    assert.equal(result.summary.candidateParity, "fail");
    assert.equal(result.summary.statusParity, "fail");
    assert.equal(result.summary.evidenceParity, "fail");
    assert.equal(result.summary.actionParity, "fail");
    assert.doesNotMatch(terminal, /Toronto Hack|https:\/\/toronto/);
  });
});
