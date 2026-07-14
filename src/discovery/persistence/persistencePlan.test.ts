import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UpsertCandidateInput, AddEvidenceInput } from "@/core/candidates/types";
import type { Database } from "@/lib/supabase/database.types";
import { planPersistence, type IncomingCandidateWrite } from "@/discovery/persistence/persistencePlan";
import { candidateRowFromUpsertInput } from "@/server/candidates/mappers";
import { normalizeEvidenceUrlKey } from "@/lib/http/evidenceUrl";

type CandidateRow = Database["public"]["Tables"]["candidates"]["Row"];
type EvidenceRow = Database["public"]["Tables"]["candidate_evidence"]["Row"];

const NOW = "2026-07-14T12:00:00.000Z";

function candidate(overrides: Partial<UpsertCandidateInput> = {}): UpsertCandidateInput {
  return {
    fingerprint: "fp-alpha",
    name: "Alpha Hack",
    source: "mlh",
    status: "NEW",
    score: 82,
    officialUrl: "https://alpha.example",
    applyUrl: "https://alpha.example/apply",
    startDate: "2026-09-01",
    deadline: "2026-08-15",
    location: "Toronto",
    mode: "in-person",
    city: "Toronto",
    country: "Canada",
    themes: ["AI"],
    summary: "Alpha summary",
    whyMatch: ["Toronto"],
    redFlags: [],
    sourceIds: { mlh: "alpha" },
    foundAt: NOW,
    lastVerified: NOW,
    ...overrides,
  };
}

function evidence(overrides: Partial<AddEvidenceInput> = {}): AddEvidenceInput {
  return {
    type: "official_page",
    url: "https://alpha.example/?utm_source=x#frag",
    title: "Alpha",
    snippet: "Build things",
    raw: { source: "fixture" },
    foundAt: NOW,
    agentRunId: "run-1",
    ...overrides,
  };
}

function rowFrom(input: UpsertCandidateInput, overrides: Partial<CandidateRow> = {}): CandidateRow {
  const insert = candidateRowFromUpsertInput(input);
  return {
    id: "candidate-1",
    status: insert.status ?? "NEW",
    score: insert.score ?? 0,
    name: insert.name,
    source: insert.source,
    official_url: insert.official_url ?? null,
    apply_url: insert.apply_url ?? null,
    social_url: insert.social_url ?? null,
    start_date: insert.start_date ?? null,
    end_date: insert.end_date ?? null,
    deadline: insert.deadline ?? null,
    location: insert.location ?? null,
    mode: insert.mode ?? null,
    city: insert.city ?? null,
    country: insert.country ?? null,
    prize: insert.prize ?? null,
    themes: insert.themes ?? [],
    eligibility: insert.eligibility ?? null,
    description: insert.description ?? null,
    summary: insert.summary ?? null,
    why_match: insert.why_match ?? [],
    red_flags: insert.red_flags ?? [],
    fingerprint: insert.fingerprint,
    source_ids: insert.source_ids ?? {},
    sheet_row_id: null,
    sheet_appended_at: null,
    found_at: insert.found_at ?? NOW,
    last_verified: insert.last_verified ?? NOW,
    approved_at: null,
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
    url: "https://alpha.example/",
    url_key: normalizeEvidenceUrlKey("https://alpha.example/"),
    title: "Alpha",
    snippet: "Build things",
    raw: { source: "fixture" },
    found_at: NOW,
    first_seen_at: NOW,
    last_seen_at: NOW,
    seen_count: 1,
    agent_run_id: "run-0",
    created_at: NOW,
    ...overrides,
  };
}

function write(input = candidate(), items = [evidence()]): IncomingCandidateWrite {
  return { candidate: input, evidence: items };
}

function planKey(plan: ReturnType<typeof planPersistence>): string {
  return JSON.stringify({
    creates: plan.candidateCreates.map((item) => item.fingerprint),
    updates: plan.candidateUpdates.map((item) => [item.fingerprint, item.payload]),
    unchanged: plan.candidateUnchanged,
    evidenceCreates: plan.evidenceCreates.map((item) => [
      item.candidateFingerprint,
      item.type,
      item.urlKey,
    ]),
    evidenceUpdates: plan.evidenceUpdates.map((item) => [item.id, item.payload]),
    actions: plan.actionsToCreate.map((item) => item.action),
    diagnostics: plan.diagnostics,
  });
}

describe("planPersistence", () => {
  it("plans a new candidate as a create", () => {
    const plan = planPersistence([write()], [], [], { now: NOW });

    assert.equal(plan.candidateCreates.length, 1);
    assert.equal(plan.candidateCreates[0]?.row.fingerprint, "fp-alpha");
    assert.equal(plan.candidateUpdates.length, 0);
    assert.equal(plan.evidenceCreates.length, 1);
  });

  it("plans an existing changed candidate as an update", () => {
    const existing = rowFrom(candidate({ summary: null }));
    const plan = planPersistence([write(candidate({ summary: "New summary" }))], [existing], [], {
      now: NOW,
    });

    assert.equal(plan.candidateCreates.length, 0);
    assert.equal(plan.candidateUpdates.length, 1);
    assert.equal(plan.candidateUpdates[0]?.payload.summary, "New summary");
    assert.equal(plan.candidateUpdates[0]?.payload.last_verified, NOW);
    assert.equal(plan.actionsToCreate.length, 1);
  });

  it("plans an existing identical candidate as unchanged", () => {
    const input = candidate();
    const existing = rowFrom(input);
    const plan = planPersistence([write(input, [])], [existing], [], { now: NOW });

    assert.equal(plan.candidateUpdates.length, 0);
    assert.deepEqual(plan.candidateUnchanged, [{ fingerprint: "fp-alpha", id: "candidate-1" }]);
    assert.equal(plan.actionsToCreate.length, 0);
  });

  it("dedupes duplicate incoming fingerprints", () => {
    const plan = planPersistence(
      [
        write(candidate({ fingerprint: "fp-alpha", themes: ["AI"] }), []),
        write(candidate({ fingerprint: "fp-alpha", themes: ["Fintech"] }), []),
      ],
      [],
      [],
      { now: NOW },
    );

    assert.equal(plan.candidateCreates.length, 1);
    assert.deepEqual(plan.candidateCreates[0]?.row.themes, ["AI", "Fintech"]);
    assert.equal(plan.diagnostics.duplicateIncomingCandidates, 1);
  });

  it("is independent from array input order", () => {
    const first = write(candidate({ fingerprint: "fp-a", name: "A" }), [
      evidence({ url: "https://a.example" }),
    ]);
    const second = write(candidate({ fingerprint: "fp-b", name: "B" }), [
      evidence({ url: "https://b.example" }),
    ]);

    const left = planPersistence([first, second], [], [], { now: NOW });
    const right = planPersistence([second, first], [], [], { now: NOW });

    assert.equal(planKey(left), planKey(right));
  });

  it("merges multiple source IDs for duplicate incoming candidates", () => {
    const plan = planPersistence(
      [
        write(candidate({ sourceIds: { mlh: "alpha" } }), []),
        write(candidate({ sourceIds: { devpost: "alpha-devpost" } }), []),
      ],
      [],
      [],
      { now: NOW },
    );

    assert.deepEqual(plan.candidateCreates[0]?.row.source_ids, {
      devpost: "alpha-devpost",
      mlh: "alpha",
    });
  });

  it("preserves owner-reviewed status on updates", () => {
    const existing = rowFrom(candidate(), {
      status: "APPROVED",
      approved_at: NOW,
    });
    const plan = planPersistence(
      [write(candidate({ status: "NEEDS_REVIEW", score: 91 }), [])],
      [existing],
      [],
      { now: NOW },
    );

    assert.equal(plan.candidateUpdates.length, 1);
    assert.equal("status" in (plan.candidateUpdates[0]?.payload ?? {}), false);
    assert.equal("approved_at" in (plan.candidateUpdates[0]?.payload ?? {}), false);
    assert.equal(plan.actionsToCreate[0]?.action.previousStatus, "APPROVED");
    assert.equal(plan.actionsToCreate[0]?.action.newStatus, "APPROVED");
  });

  it("does not reset rejected or restored statuses", () => {
    for (const status of ["REJECTED", "SAVED_FOR_LATER", "NEW"] as const) {
      const existing = rowFrom(candidate(), { status });
      const plan = planPersistence(
        [write(candidate({ status: "NEEDS_REVIEW", score: 99 }), [])],
        [existing],
        [],
        { now: NOW },
      );

      assert.equal("status" in (plan.candidateUpdates[0]?.payload ?? {}), false);
      assert.equal(plan.actionsToCreate[0]?.action.previousStatus, status);
    }
  });

  it("plans new evidence as a create", () => {
    const existing = rowFrom(candidate());
    const plan = planPersistence([write(candidate())], [existing], [], { now: NOW });

    assert.equal(plan.evidenceCreates.length, 1);
    assert.equal(plan.evidenceCreates[0]?.candidateId, "candidate-1");
    assert.equal(plan.evidenceCreates[0]?.urlKey, "https://alpha.example/");
  });

  it("plans existing evidence as an update with seen count bump", () => {
    const existing = rowFrom(candidate());
    const plan = planPersistence([write(candidate())], [existing], [evidenceRow()], { now: NOW });

    assert.equal(plan.evidenceUpdates.length, 1);
    assert.equal(plan.evidenceUpdates[0]?.payload.seen_count, 2);
    assert.equal(plan.evidenceUpdates[0]?.payload.agent_run_id, "run-1");
  });

  it("dedupes duplicate incoming evidence", () => {
    const existing = rowFrom(candidate());
    const plan = planPersistence(
      [write(candidate(), [evidence(), evidence({ title: "Duplicate" })])],
      [existing],
      [],
      { now: NOW },
    );

    assert.equal(plan.evidenceCreates.length, 1);
    assert.equal(plan.evidenceCreates[0]?.observationCount, 2);
    assert.equal(plan.evidenceCreates[0]?.seenCountIncrement, 2);
    assert.equal(plan.evidenceCreates[0]?.row.seen_count, 2);
    assert.equal(plan.evidenceUnchanged.length, 0);
    assert.equal(plan.diagnostics.incomingEvidence, 2);
    assert.equal(plan.diagnostics.uniqueEvidence, 1);
    assert.equal(plan.diagnostics.duplicateEvidenceObservations, 1);
  });

  it("does not create duplicate actions for idempotent unchanged reruns", () => {
    const input = candidate();
    const existing = rowFrom(input, { status: "APPROVED" });
    const plan = planPersistence([write(input, [])], [existing], [], { now: NOW });

    assert.equal(plan.candidateUnchanged.length, 1);
    assert.equal(plan.actionsToCreate.length, 0);
  });
});
