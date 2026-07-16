import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AcceptedCandidate } from "@/core/discovery/types";
import {
  BatchPersistenceStrategy,
  createPersistenceStrategy,
  formatPersistenceSummary,
  isPersistenceV1Selected,
  selectPersistenceStrategyFromEnv,
  PERSISTENCE_V1_SOAK_BLOCKER,
} from "@/discovery/persistence/strategies";
import {
  BatchPersistenceRepository,
  type BatchPersistenceAdapter,
} from "@/discovery/persistence/batchPersistenceRepository";
import { planPersistence, type CandidateRow, type EvidenceRow } from "@/discovery/persistence/persistencePlan";
import { normalizeEvidenceUrlKey } from "@/lib/http/evidenceUrl";

const NOW = "2026-07-16T12:00:00.000Z";

function accepted(
  name: string,
  fingerprintHint: string,
  overrides: Partial<AcceptedCandidate> = {},
): AcceptedCandidate {
  const slug = fingerprintHint;
  return {
    event: {
      name,
      source: "mlh",
      officialUrl: `https://${slug}.example`,
      applyUrl: `https://${slug}.example/apply`,
      startDate: "2026-09-01",
      deadline: "2026-08-01",
      location: "Toronto",
      mode: "in-person",
      city: "Toronto",
      country: "Canada",
      themes: ["AI"],
      sourceIds: { mlh: slug },
      evidence: [
        {
          type: "official_page",
          url: `https://${slug}.example`,
          title: name,
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
    official_url: "https://toronto.example",
    apply_url: "https://toronto.example/apply",
    social_url: null,
    start_date: "2026-09-01",
    end_date: null,
    deadline: "2026-08-01",
    location: "Toronto",
    mode: "in-person",
    city: "Toronto",
    country: "Canada",
    prize: null,
    themes: ["AI"],
    eligibility: null,
    description: null,
    summary: null,
    why_match: ["Toronto"],
    red_flags: [],
    fingerprint: "fp-toronto",
    source_ids: { mlh: "toronto" },
    sheet_row_id: "sheet-7",
    sheet_appended_at: NOW,
    found_at: NOW,
    last_verified: NOW,
    approved_at: NOW,
    rejected_at: null,
    saved_at: "2026-07-01T00:00:00.000Z",
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
    title: "Toronto Hack",
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

type CallCounts = {
  candidateLookup: number;
  candidateInsert: number;
  candidateUpdate: number;
  evidenceLookup: number;
  evidenceInsert: number;
  evidenceUpdate: number;
  actionInsert: number;
};

function countingAdapter(
  seed: {
    candidates?: CandidateRow[];
    evidence?: EvidenceRow[];
  } = {},
  overrides: Partial<BatchPersistenceAdapter> = {},
): { adapter: BatchPersistenceAdapter; counts: CallCounts; store: { candidates: CandidateRow[]; evidence: EvidenceRow[] } } {
  const counts: CallCounts = {
    candidateLookup: 0,
    candidateInsert: 0,
    candidateUpdate: 0,
    evidenceLookup: 0,
    evidenceInsert: 0,
    evidenceUpdate: 0,
    actionInsert: 0,
  };
  const store = {
    candidates: [...(seed.candidates ?? [])],
    evidence: [...(seed.evidence ?? [])],
  };

  const adapter: BatchPersistenceAdapter = {
    async selectCandidatesByFingerprints(fingerprints) {
      counts.candidateLookup += 1;
      const wanted = new Set(fingerprints);
      return store.candidates.filter((row) => wanted.has(row.fingerprint));
    },
    async insertCandidates(rows) {
      counts.candidateInsert += 1;
      const created = rows.map((row, index) =>
        candidateRow({
          id: `created-${store.candidates.length + index}`,
          status: row.status ?? "NEW",
          fingerprint: row.fingerprint,
          name: row.name,
          source: row.source,
          official_url: row.official_url ?? null,
          apply_url: row.apply_url ?? null,
          source_ids: row.source_ids ?? {},
          sheet_row_id: null,
          sheet_appended_at: null,
          approved_at: null,
          rejected_at: null,
          saved_at: null,
          score: row.score ?? 0,
        }),
      );
      store.candidates.push(...created);
      return created;
    },
    async upsertCandidateUpdates(rows) {
      counts.candidateUpdate += 1;
      return rows.map((row) => {
        const index = store.candidates.findIndex((item) => item.id === row.id);
        const existing = store.candidates[index] ?? candidateRow({ id: row.id!, fingerprint: row.fingerprint! });
        const merged = { ...existing, ...row, id: existing.id, fingerprint: existing.fingerprint } as CandidateRow;
        if (index >= 0) store.candidates[index] = merged;
        else store.candidates.push(merged);
        return merged;
      });
    },
    async selectEvidenceByCandidateIds(candidateIds) {
      counts.evidenceLookup += 1;
      const wanted = new Set(candidateIds);
      return store.evidence.filter((row) => wanted.has(row.candidate_id));
    },
    async insertEvidence(rows) {
      counts.evidenceInsert += 1;
      const created = rows.map((row, index) =>
        evidenceRow({
          id: `created-e-${store.evidence.length + index}`,
          candidate_id: row.candidate_id,
          type: row.type,
          url: row.url ?? null,
          url_key: row.url_key,
          title: row.title ?? null,
          seen_count: row.seen_count ?? 1,
        }),
      );
      store.evidence.push(...created);
      return created;
    },
    async upsertEvidenceUpdates(rows) {
      counts.evidenceUpdate += 1;
      return rows.map((row) => {
        const index = store.evidence.findIndex((item) => item.id === row.id);
        const existing = store.evidence[index] ?? evidenceRow({ id: row.id! });
        const merged = { ...existing, ...row, id: existing.id } as EvidenceRow;
        if (index >= 0) store.evidence[index] = merged;
        else store.evidence.push(merged);
        return merged;
      });
    },
    async insertActions(rows) {
      counts.actionInsert += 1;
      return rows.map((row, index) => ({ ...row, id: `action-${index}` }));
    },
    ...overrides,
  };

  return { adapter, counts, store };
}

function strategyFrom(adapter: BatchPersistenceAdapter, chunkSizes?: Partial<Record<string, number>>) {
  return new BatchPersistenceStrategy(
    new BatchPersistenceRepository(adapter, chunkSizes ? { chunkSizes } : undefined),
  );
}

describe("C1 batch-only persistence contracts", () => {
  it("documents the V1 soak/deletion blocker", () => {
    assert.match(PERSISTENCE_V1_SOAK_BLOCKER, /unreachable in normal production/);
    assert.match(PERSISTENCE_V1_SOAK_BLOCKER, /C4/);
  });

  it("keeps V1 unreachable in normal production env selection", () => {
    assert.equal(isPersistenceV1Selected({}), false);
    assert.equal(isPersistenceV1Selected({ PERSISTENCE_STRATEGY: "v1" }), false);
    assert.equal(isPersistenceV1Selected({ PERSISTENCE_STRATEGY: "nope" }), false);
    assert.equal(isPersistenceV1Selected({ PERSISTENCE_ROLLBACK_V1: "1" }), true);
    assert.equal(createPersistenceStrategy(selectPersistenceStrategyFromEnv({})).name, "batch");
  });

  it("emits a compact persistence summary without payloads", () => {
    const summary = formatPersistenceSummary({
      strategy: "batch",
      created: 2,
      updated: 1,
      unchanged: 3,
      wouldCreate: 0,
      wouldUpdate: 0,
      stored: 2,
      duplicatesUpdated: 1,
      evidenceWritten: 4,
      wouldAttachEvidence: 0,
      actionsWritten: 1,
      storageFailures: 0,
      warnings: [],
      errors: [],
      candidateIds: ["a", "b"],
      timing: {
        skipped: false,
        strategy: "batch",
        totalMs: 12.4,
        candidateMs: 1,
        evidenceMs: 1,
        actionMs: 1,
        completionMs: 0,
        acceptedCandidates: 5,
        evidenceObservations: 4,
        evidenceMutations: 4,
        actionsWritten: 1,
        candidateLookups: 1,
        candidateInserts: 2,
        candidateUpdates: 1,
        candidateFailures: 0,
        evidenceLookups: 1,
        evidenceInserts: 3,
        evidenceUpdates: 1,
        evidenceFailures: 0,
        databaseCalls: 6,
      },
      writeProgress: {
        writesStarted: true,
        candidateWritesCompleted: true,
        evidenceWritesCompleted: true,
        actionWritesCompleted: true,
      },
    });

    assert.match(summary, /^\[persistence\] /);
    assert.match(summary, /strategy=batch/);
    assert.match(summary, /created=2/);
    assert.match(summary, /db_calls=6/);
    assert.doesNotMatch(summary, /officialUrl|https:\/\/|candidateIds/);
  });

  it("Case A: identical rerun creates zero candidates and does not duplicate evidence", async () => {
    const first = countingAdapter();
    const strategy1 = strategyFrom(first.adapter);
    const fixture = [accepted("Toronto Hack", "toronto")];

    const run1 = await strategy1.persist({
      accepted: fixture,
      dryRun: false,
      now: new Date(NOW),
      assertNotCancelled: () => {},
    });
    assert.equal(run1.created, 1);
    assert.equal(first.store.candidates.length, 1);
    assert.equal(first.store.evidence.length, 1);

    const second = countingAdapter({
      candidates: first.store.candidates,
      evidence: first.store.evidence,
    });
    const strategy2 = strategyFrom(second.adapter);
    const run2 = await strategy2.persist({
      accepted: fixture,
      dryRun: false,
      now: new Date(NOW),
      assertNotCancelled: () => {},
    });

    assert.equal(run2.created, 0);
    assert.equal(second.store.candidates.length, 1);
    assert.equal(second.counts.candidateInsert, 0);
    // Identical evidence may refresh seen_count / last_seen (bookkeeping), not insert duplicates.
    assert.equal(second.store.evidence.length, 1);
    assert.equal(second.store.candidates[0]?.status, first.store.candidates[0]?.status);
    assert.equal(second.store.candidates[0]?.sheet_row_id, first.store.candidates[0]?.sheet_row_id);
  });

  it("Case B: one new event creates exactly one candidate", async () => {
    const existing = candidateRow({
      id: "existing-1",
      fingerprint: "will-be-overwritten-by-run",
      status: "APPROVED",
      approved_at: NOW,
      sheet_row_id: "sheet-keep",
    });
    // Seed via first persist so fingerprints match real upsert fingerprinting.
    const seed = countingAdapter();
    const seedStrategy = strategyFrom(seed.adapter);
    await seedStrategy.persist({
      accepted: [accepted("Toronto Hack", "toronto")],
      dryRun: false,
      now: new Date(NOW),
      assertNotCancelled: () => {},
    });
    const owned = {
      ...seed.store.candidates[0]!,
      status: "APPROVED" as const,
      approved_at: NOW,
      sheet_row_id: "sheet-keep",
      sheet_appended_at: NOW,
      saved_at: NOW,
    };

    const next = countingAdapter({
      candidates: [owned],
      evidence: seed.store.evidence.map((row) => ({ ...row, candidate_id: owned.id })),
    });
    const result = await strategyFrom(next.adapter).persist({
      accepted: [accepted("Toronto Hack", "toronto"), accepted("Montreal Hack", "montreal")],
      dryRun: false,
      now: new Date(NOW),
      assertNotCancelled: () => {},
    });

    assert.equal(result.created, 1);
    assert.equal(next.store.candidates.length, 2);
    const preserved = next.store.candidates.find((row) => row.id === owned.id);
    assert.equal(preserved?.status, "APPROVED");
    assert.equal(preserved?.sheet_row_id, "sheet-keep");
    assert.equal(preserved?.approved_at, NOW);
    assert.equal(preserved?.saved_at, NOW);
    void existing;
  });

  it("Case C: one changed source field updates only the intended candidate", async () => {
    const seed = countingAdapter();
    await strategyFrom(seed.adapter).persist({
      accepted: [accepted("Toronto Hack", "toronto"), accepted("Montreal Hack", "montreal")],
      dryRun: false,
      now: new Date(NOW),
      assertNotCancelled: () => {},
    });

    const owned = seed.store.candidates.map((row) =>
      row.name === "Toronto Hack"
        ? {
            ...row,
            status: "APPROVED" as const,
            approved_at: NOW,
            sheet_row_id: "sheet-1",
            sheet_appended_at: NOW,
          }
        : {
            ...row,
            status: "REJECTED" as const,
            rejected_at: NOW,
            sheet_row_id: "sheet-2",
          },
    );

    const next = countingAdapter({
      candidates: owned,
      evidence: seed.store.evidence,
    });
    const changed = accepted("Toronto Hack", "toronto");
    changed.score = {
      score: 77,
      whyMatch: ["Toronto", "prize"],
      redFlags: [],
      rejected: false,
    };
    changed.event.prize = "$10k";

    const result = await strategyFrom(next.adapter).persist({
      accepted: [changed, accepted("Montreal Hack", "montreal")],
      dryRun: false,
      now: new Date(NOW),
      assertNotCancelled: () => {},
    });

    assert.ok(result.updated >= 1);
    assert.equal(result.created, 0);
    const toronto = next.store.candidates.find((row) => row.name === "Toronto Hack");
    const montreal = next.store.candidates.find((row) => row.name === "Montreal Hack");
    assert.equal(toronto?.status, "APPROVED");
    assert.equal(toronto?.sheet_row_id, "sheet-1");
    assert.equal(toronto?.score, 77);
    assert.equal(toronto?.prize, "$10k");
    assert.equal(montreal?.status, "REJECTED");
    assert.equal(montreal?.sheet_row_id, "sheet-2");
    assert.equal(montreal?.rejected_at, NOW);
  });

  it("Case D: duplicate incoming leads produce one candidate", async () => {
    const { adapter, store, counts } = countingAdapter();
    const duplicate = accepted("Toronto Hack", "toronto");
    const result = await strategyFrom(adapter).persist({
      accepted: [duplicate, { ...duplicate, event: { ...duplicate.event } }],
      dryRun: false,
      now: new Date(NOW),
      assertNotCancelled: () => {},
    });

    assert.equal(result.created, 1);
    assert.equal(store.candidates.length, 1);
    assert.equal(counts.candidateInsert, 1);
  });

  it("Case E: multi-source evidence for same identity is retained", () => {
    const plan = planPersistence(
      [
        {
          candidate: {
            fingerprint: "fp-shared",
            name: "Shared Hack",
            source: "mlh",
            sourceIds: { mlh: "shared" },
          },
          evidence: [{ type: "mlh_page", url: "https://shared.example/mlh", foundAt: NOW }],
        },
        {
          candidate: {
            fingerprint: "fp-shared",
            name: "Shared Hack",
            source: "devpost",
            sourceIds: { devpost: "shared" },
          },
          evidence: [{ type: "devpost_page", url: "https://shared.example/devpost", foundAt: NOW }],
        },
      ],
      [],
      [],
      { now: NOW },
    );

    assert.equal(plan.candidateCreates.length, 1);
    assert.equal(plan.evidenceCreates.length, 2);
    assert.deepEqual(plan.candidateCreates[0]?.row.source_ids, { mlh: "shared", devpost: "shared" });
  });

  it("protects owner and Sheets fields on planned updates", () => {
    const existing = candidateRow({
      status: "APPROVED",
      approved_at: NOW,
      rejected_at: null,
      saved_at: NOW,
      sheet_row_id: "sheet-keep",
      sheet_appended_at: NOW,
    });
    const plan = planPersistence(
      [
        {
          candidate: {
            fingerprint: existing.fingerprint,
            name: "Toronto Hack Renamed",
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
    for (const key of [
      "status",
      "approved_at",
      "rejected_at",
      "saved_at",
      "sheet_row_id",
      "sheet_appended_at",
    ] as const) {
      assert.equal(key in update!.payload, false, `${key} must stay owner/Sheets managed`);
    }
  });

  it("uses chunked identity lookup rather than per-candidate queries", async () => {
    const items = Array.from({ length: 100 }, (_, index) =>
      accepted(`Hack ${index}`, `hack-${index}`),
    );
    const { adapter, counts } = countingAdapter();
    const result = await strategyFrom(adapter, {
      candidateLookup: 40,
      candidateWrite: 40,
      evidenceLookup: 40,
      evidenceWrite: 50,
      actionWrite: 50,
    }).persist({
      accepted: items,
      dryRun: false,
      now: new Date(NOW),
      assertNotCancelled: () => {},
    });

    assert.equal(result.created, 100);
    // 100 fingerprints / 40 ≈ 3 lookup chunks; not 100.
    assert.ok(counts.candidateLookup <= 3, `lookups=${counts.candidateLookup}`);
    assert.ok(counts.candidateInsert <= 3, `inserts=${counts.candidateInsert}`);
    assert.ok(counts.evidenceInsert <= 3, `evidence inserts=${counts.evidenceInsert}`);
    assert.ok(
      counts.candidateLookup + counts.candidateInsert + counts.evidenceInsert < 100,
      "must not be O(candidates) network calls",
    );
    assert.ok((result.timing.databaseCalls ?? 0) < 100);
  });

  it("dry-run writes nothing", async () => {
    const { adapter, counts } = countingAdapter({
      candidates: [],
    });
    const result = await strategyFrom(adapter).persist({
      accepted: [accepted("Toronto Hack", "toronto")],
      dryRun: true,
      now: new Date(NOW),
      assertNotCancelled: () => {},
    });

    assert.equal(result.wouldCreate, 1);
    assert.equal(result.created, 0);
    assert.equal(counts.candidateLookup, 0);
    assert.equal(counts.candidateInsert, 0);
    assert.equal(counts.evidenceInsert, 0);
    assert.equal(counts.actionInsert, 0);
  });

  it("reports partial failure without claiming full success", async () => {
    const { adapter } = countingAdapter(
      {},
      {
        async insertEvidence() {
          throw new Error("evidence failed");
        },
      },
    );
    const result = await strategyFrom(adapter).persist({
      accepted: [accepted("Toronto Hack", "toronto")],
      dryRun: false,
      now: new Date(NOW),
      assertNotCancelled: () => {},
    });

    assert.equal(result.storageFailures, 1);
    assert.ok(result.errors.length > 0);
    assert.equal(result.writeProgress?.candidateWritesCompleted, true);
    assert.equal(result.writeProgress?.evidenceWritesCompleted, false);
  });
});
