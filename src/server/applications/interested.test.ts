import assert from "node:assert/strict";
import test from "node:test";
import { startInterestedApplication } from "@/server/applications/interested";
import type { CandidateCard } from "@/core/candidates/types";

const candidate = (opensAt: string | null): CandidateCard => ({ id: "candidate", status: "APPROVED", score: 1, name: "Fixture", summary: null, source: "test", officialUrl: null, applyUrl: "https://fixture.invalid/apply", socialUrl: null, startDate: null, endDate: null, deadline: null, location: null, mode: null, city: null, country: null, prize: null, themes: [], eligibility: null, whyMatch: [], redFlags: [], foundAt: "2026-01-01", lastVerified: "2026-01-01", approvedAt: null, sheetRowId: null, sheetAppendedAt: null, applicationOpensAt: opensAt });
test("Interested drafts an open opportunity and schedules a future one", async () => {
  let calls = 0; const prepare = async () => { calls++; return { application: { id: "draft" } as never }; };
  assert.equal((await startInterestedApplication(candidate(null), prepare)).state, "drafted");
  assert.equal((await startInterestedApplication(candidate("2030-01-01"), prepare, new Date("2026-01-01"))).state, "scheduled"); assert.equal(calls, 1);
});
