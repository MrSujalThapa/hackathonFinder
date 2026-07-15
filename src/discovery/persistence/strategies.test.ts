import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AcceptedCandidate } from "@/core/discovery/types";
import {
  BatchPersistenceStrategy,
  createPersistenceStrategy,
  selectPersistenceStrategyFromEnv,
} from "@/discovery/persistence/strategies";
import {
  BatchPersistenceRepository,
  type BatchPersistenceAdapter,
} from "@/discovery/persistence/batchPersistenceRepository";
import { planPersistence, type CandidateRow, type EvidenceRow } from "@/discovery/persistence/persistencePlan";
import { normalizeEvidenceUrlKey } from "@/lib/http/evidenceUrl";

const NOW = "2026-07-14T00:00:00.000Z";

function accepted(overrides: Partial<AcceptedCandidate> = {}): AcceptedCandidate {
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
    ...overrides,
  };
}

function candidateRow(overrides: Partial<CandidateRow> = {}): CandidateRow {
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
    fingerprint: "fp-safe",
    source_ids: { mlh: "old" },
    sheet_row_id: "sheet-7",
    sheet_appended_at: NOW,
    found_at: NOW,
    last_verified: NOW,
    approved_at: NOW,
    rejected_at: null,
    saved_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function evidenceRow(overrides: Partial<EvidenceRow> = {}): EvidenceRow {
  return {
    id: "evidence-1",
    candidate_id: "candidate-1",
    type: "official_page",
    url: "https://toronto.example",
    url_key: normalizeEvidenceUrlKey("https://toronto.example"),
    title: "Existing",
    snippet: null,
    raw: {},
    found_at: NOW,
    created_at: NOW,
    first_seen_at: NOW,
    last_seen_at: NOW,
    seen_count: 1,
    agent_run_id: null,
    ...overrides,
  };
}

function adapter(overrides: Partial<BatchPersistenceAdapter> = {}): BatchPersistenceAdapter {
  return {
    async selectCandidatesByFingerprints() {
      return [];
    },
    async insertCandidates(rows) {
      return rows.map((row, index) =>
        candidateRow({
          id: `created-${index}`,
          status: row.status ?? "NEW",
          fingerprint: row.fingerprint,
          name: row.name,
        }),
      );
    },
    async upsertCandidateUpdates(rows) {
      return rows.map((row) => candidateRow({ id: row.id, fingerprint: row.fingerprint }));
    },
    async selectEvidenceByCandidateIds() {
      return [];
    },
    async insertEvidence(rows) {
      return rows.map((row, index) =>
        evidenceRow({ id: `created-e-${index}`, candidate_id: row.candidate_id }),
      );
    },
    async upsertEvidenceUpdates(rows) {
      return rows.map((row) => evidenceRow({ id: row.id, candidate_id: row.candidate_id }));
    },
    async insertActions(rows) {
      return rows.map((row, index) => ({ ...row, id: `action-${index}` }));
    },
    ...overrides,
  };
}

describe("persistence strategy selection", () => {
  it("defaults to v1 and accepts explicit v1", () => {
    assert.equal(selectPersistenceStrategyFromEnv({}).name, "v1");
    assert.equal(selectPersistenceStrategyFromEnv({ PERSISTENCE_STRATEGY: "v1" }).name, "v1");
    assert.equal(createPersistenceStrategy({ name: "v1" }).name, "v1");
  });

  it("selects batch only from explicit server configuration", () => {
    assert.equal(selectPersistenceStrategyFromEnv({ PERSISTENCE_STRATEGY: "batch" }).name, "batch");
  });

  it("does not silently select batch for invalid values or terminal command text", () => {
    const invalid = selectPersistenceStrategyFromEnv({ PERSISTENCE_STRATEGY: "fast" });
    const commandText = selectPersistenceStrategyFromEnv({
      PERSISTENCE_STRATEGY: "find upcoming hackathons --persistence=batch",
    });

    assert.equal(invalid.name, "v1");
    assert.match(invalid.warning ?? "", /Invalid PERSISTENCE_STRATEGY/);
    assert.equal(commandText.name, "v1");
  });

  it("keeps production-like default on v1 unless explicitly configured", () => {
    assert.equal(selectPersistenceStrategyFromEnv({ NODE_ENV: "production" }).name, "v1");
  });
});

describe("batch persistence strategy integration", () => {
  it("dry-run returns an equivalent result shape without repository calls", async () => {
    const strategy = new BatchPersistenceStrategy(
      new BatchPersistenceRepository(
        adapter({
          async selectCandidatesByFingerprints() {
            throw new Error("read called");
          },
          async insertCandidates() {
            throw new Error("write called");
          },
        }),
      ),
    );

    const result = await strategy.persist({
      accepted: [accepted()],
      dryRun: true,
      now: new Date(NOW),
      assertNotCancelled: () => {},
    });

    assert.equal(result.strategy, "batch");
    assert.equal(result.wouldCreate, 1);
    assert.equal(result.wouldAttachEvidence, 1);
    assert.equal(result.evidenceWritten, 0);
    assert.equal(result.storageFailures, 0);
  });

  it("reports partial evidence failures without V1 fallback", async () => {
    const strategy = new BatchPersistenceStrategy(
      new BatchPersistenceRepository(
        adapter({
          async insertEvidence() {
            throw new Error("evidence failed");
          },
        }),
      ),
    );

    const result = await strategy.persist({
      accepted: [accepted()],
      dryRun: false,
      now: new Date(NOW),
      assertNotCancelled: () => {},
    });

    assert.equal(result.storageFailures, 1);
    assert.equal(result.created, 1);
    assert.equal(result.evidenceWritten, 0);
    assert.equal(result.writeProgress?.candidateWritesCompleted, true);
    assert.equal(result.writeProgress?.evidenceWritesCompleted, false);
    assert.match(result.errors.join("\n"), /Batch persistence failed/);
  });

  it("plans protected owner and sheet fields as unchanged on updates", () => {
    const existing = candidateRow();
    const plan = planPersistence(
      [
        {
          candidate: {
            fingerprint: "fp-safe",
            name: "Toronto Hack Updated",
            source: "devpost",
            status: "NEW",
            score: 99,
            sourceIds: { devpost: "new" },
          },
          evidence: [],
        },
      ],
      [existing],
      [],
      { now: NOW },
    );

    const update = plan.candidateUpdates[0];
    assert.ok(update);
    assert.equal("status" in update!.payload, false);
    assert.equal("approved_at" in update!.payload, false);
    assert.equal("sheet_row_id" in update!.payload, false);
    assert.equal("sheet_appended_at" in update!.payload, false);
    assert.deepEqual(update!.payload.source_ids, { mlh: "old", devpost: "new" });
  });

  it("preserves duplicate evidence multiplicity in integrated plans", () => {
    const plan = planPersistence(
      [
        {
          candidate: {
            fingerprint: "fp-new",
            name: "Toronto Hack",
            source: "mlh",
          },
          evidence: [
            { type: "official_page", url: "https://toronto.example", foundAt: NOW },
            { type: "official_page", url: "https://toronto.example", foundAt: NOW },
          ],
        },
      ],
      [],
      [],
      { now: NOW },
    );

    assert.equal(plan.diagnostics.incomingEvidence, 2);
    assert.equal(plan.diagnostics.uniqueEvidence, 1);
    assert.equal(plan.diagnostics.duplicateEvidenceObservations, 1);
    assert.equal(plan.evidenceCreates[0]?.observationCount, 2);
    assert.equal(plan.evidenceCreates[0]?.row.seen_count, 2);
  });

  it("reports post-write parity pass when reread evidence matches the plan", async () => {
    const previous = process.env.PERSISTENCE_BATCH_VERIFY_AFTER_WRITE;
    process.env.PERSISTENCE_BATCH_VERIFY_AFTER_WRITE = "true";
    let currentEvidence = evidenceRow();
    try {
      const strategy = new BatchPersistenceStrategy(
        new BatchPersistenceRepository(
          adapter({
            async selectCandidatesByFingerprints(fingerprints) {
              return [candidateRow({ fingerprint: fingerprints[0] ?? "fp" })];
            },
            async selectEvidenceByCandidateIds() {
              return [currentEvidence];
            },
            async upsertEvidenceUpdates(rows) {
              currentEvidence = evidenceRow({
                ...rows[0],
                id: rows[0]?.id ?? "evidence-1",
                candidate_id: rows[0]?.candidate_id ?? "candidate-1",
              });
              return [currentEvidence];
            },
          }),
        ),
      );

      const result = await strategy.persist({
        accepted: [accepted()],
        dryRun: false,
        now: new Date(NOW),
        assertNotCancelled: () => {},
      });

      assert.equal(result.postWriteParity, "pass");
      assert.equal(result.timing.postWriteParity, "pass");
      assert.equal(result.storageFailures, 0);
    } finally {
      if (previous == null) {
        delete process.env.PERSISTENCE_BATCH_VERIFY_AFTER_WRITE;
      } else {
        process.env.PERSISTENCE_BATCH_VERIFY_AFTER_WRITE = previous;
      }
    }
  });

  it("reports post-write parity pass for evidence on newly created candidates", async () => {
    const previous = process.env.PERSISTENCE_BATCH_VERIFY_AFTER_WRITE;
    process.env.PERSISTENCE_BATCH_VERIFY_AFTER_WRITE = "true";
    const writtenEvidence: EvidenceRow[] = [];
    try {
      const strategy = new BatchPersistenceStrategy(
        new BatchPersistenceRepository(
          adapter({
            async selectCandidatesByFingerprints() {
              return [];
            },
            async selectEvidenceByCandidateIds() {
              return writtenEvidence;
            },
            async insertEvidence(rows) {
              const created = rows.map((row, index) =>
                evidenceRow({
                  id: `created-e-${index}`,
                  candidate_id: row.candidate_id,
                  type: row.type,
                  url: row.url ?? null,
                  url_key: row.url_key,
                  title: row.title ?? null,
                  snippet: row.snippet ?? null,
                  raw: row.raw ?? {},
                  found_at: row.found_at ?? NOW,
                  first_seen_at: row.first_seen_at ?? row.found_at ?? NOW,
                  last_seen_at: row.last_seen_at ?? row.found_at ?? NOW,
                  seen_count: row.seen_count ?? 1,
                  agent_run_id: row.agent_run_id ?? null,
                }),
              );
              writtenEvidence.push(...created);
              return created;
            },
          }),
        ),
      );

      const result = await strategy.persist({
        accepted: [accepted()],
        dryRun: false,
        now: new Date(NOW),
        assertNotCancelled: () => {},
      });

      assert.equal(result.created, 1);
      assert.equal(result.postWriteParity, "pass");
      assert.equal(result.storageFailures, 0);
    } finally {
      if (previous == null) {
        delete process.env.PERSISTENCE_BATCH_VERIFY_AFTER_WRITE;
      } else {
        process.env.PERSISTENCE_BATCH_VERIFY_AFTER_WRITE = previous;
      }
    }
  });

  it("reports post-write parity failure safely when reread evidence differs", async () => {
    const previous = process.env.PERSISTENCE_BATCH_VERIFY_AFTER_WRITE;
    process.env.PERSISTENCE_BATCH_VERIFY_AFTER_WRITE = "true";
    try {
      const strategy = new BatchPersistenceStrategy(
        new BatchPersistenceRepository(
          adapter({
            async selectCandidatesByFingerprints(fingerprints) {
              return [candidateRow({ fingerprint: fingerprints[0] ?? "fp" })];
            },
            async selectEvidenceByCandidateIds() {
              return [evidenceRow()];
            },
          }),
        ),
      );

      const result = await strategy.persist({
        accepted: [accepted()],
        dryRun: false,
        now: new Date(NOW),
        assertNotCancelled: () => {},
      });

      assert.equal(result.postWriteParity, "fail");
      assert.equal(result.timing.postWriteParity, "fail");
      assert.match(result.warnings.join("\n"), /Post-write parity failed/);
    } finally {
      if (previous == null) {
        delete process.env.PERSISTENCE_BATCH_VERIFY_AFTER_WRITE;
      } else {
        process.env.PERSISTENCE_BATCH_VERIFY_AFTER_WRITE = previous;
      }
    }
  });
});
