import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CandidateCard } from "@/core/candidates/types";
import {
  formatSheetDate,
  mapCandidateRow,
} from "@/server/sheets/mapCandidateRow";
import {
  CANDIDATE_ID_COLUMN_INDEX,
  SHEET_HEADERS,
} from "@/server/sheets/schema";

const completeCandidate: CandidateCard = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  status: "APPROVED",
  score: 92,
  name: "Waterloo Agent Hack",
  summary: "Build agents over a weekend.",
  source: "devpost",
  officialUrl: "https://example.com/hack",
  applyUrl: "https://example.com/hack/apply",
  socialUrl: "https://x.com/example",
  startDate: "2026-09-13T00:00:00.000Z",
  endDate: "2026-09-15",
  deadline: "2026-08-01T23:59:59.000Z",
  location: "Waterloo, Canada",
  mode: "hybrid",
  city: "Waterloo",
  country: "Canada",
  prize: "$5,000",
  themes: ["AI", "agents"],
  eligibility: "Students welcome",
  whyMatch: ["AI theme", "nearby"],
  redFlags: ["short deadline"],
  foundAt: "2026-07-01T12:00:00.000Z",
  lastVerified: "2026-07-02T08:30:00.000Z",
};

describe("formatSheetDate", () => {
  it("returns empty string for missing values", () => {
    assert.equal(formatSheetDate(null), "");
    assert.equal(formatSheetDate(undefined), "");
    assert.equal(formatSheetDate(""), "");
  });

  it("keeps YYYY-MM-DD and strips time from ISO datetimes", () => {
    assert.equal(formatSheetDate("2026-09-15"), "2026-09-15");
    assert.equal(formatSheetDate("2026-09-13T00:00:00.000Z"), "2026-09-13");
  });

  it("returns original string when unparseable", () => {
    assert.equal(formatSheetDate("TBD soon"), "TBD soon");
  });
});

describe("mapCandidateRow", () => {
  it("maps a complete candidate into SHEET_HEADERS order", () => {
    const row = mapCandidateRow(completeCandidate, "2026-07-11T15:00:00.000Z");

    assert.equal(row.length, SHEET_HEADERS.length);
    assert.equal(row[0], "APPROVED");
    assert.equal(row[1], "92");
    assert.equal(row[2], "Waterloo Agent Hack");
    assert.equal(row[3], "devpost");
    assert.equal(row[4], "https://example.com/hack");
    assert.equal(row[5], "https://example.com/hack/apply");
    assert.equal(row[6], "https://x.com/example");
    assert.equal(row[7], "2026-09-13");
    assert.equal(row[8], "2026-09-15");
    assert.equal(row[9], "2026-08-01");
    assert.equal(row[10], "Waterloo, Canada");
    assert.equal(row[11], "hybrid");
    assert.equal(row[12], "Waterloo");
    assert.equal(row[13], "Canada");
    assert.equal(row[14], "$5,000");
    assert.equal(row[15], "AI; agents");
    assert.equal(row[16], "Students welcome");
    assert.equal(row[17], "Build agents over a weekend.");
    assert.equal(row[18], "AI theme; nearby");
    assert.equal(row[19], "short deadline");
    assert.equal(row[20], "2026-07-01");
    assert.equal(row[21], "2026-07-02");
    assert.equal(row[22], "2026-07-11");
    assert.equal(row[CANDIDATE_ID_COLUMN_INDEX], completeCandidate.id);
    assert.equal(SHEET_HEADERS[CANDIDATE_ID_COLUMN_INDEX], "Candidate ID");
  });

  it("maps sparse candidates with empty cells and Candidate ID", () => {
    const sparse: CandidateCard = {
      id: "11111111-2222-4333-8444-555555555555",
      status: "NEW",
      score: 10,
      name: "Sparse Hack",
      summary: null,
      source: "manual",
      officialUrl: null,
      applyUrl: null,
      socialUrl: null,
      startDate: null,
      endDate: null,
      deadline: null,
      location: null,
      mode: null,
      city: null,
      country: null,
      prize: null,
      themes: [],
      eligibility: null,
      whyMatch: [],
      redFlags: [],
      foundAt: "2026-07-10T01:02:03.000Z",
      lastVerified: "2026-07-10T01:02:03.000Z",
    };

    const row = mapCandidateRow(sparse);

    assert.equal(row.length, SHEET_HEADERS.length);
    assert.equal(row[0], "NEW");
    assert.equal(row[1], "10");
    assert.equal(row[2], "Sparse Hack");
    assert.equal(row[3], "manual");
    assert.equal(row[4], "");
    assert.equal(row[5], "");
    assert.equal(row[6], "");
    assert.equal(row[7], "");
    assert.equal(row[8], "");
    assert.equal(row[9], "");
    assert.equal(row[10], "");
    assert.equal(row[11], "");
    assert.equal(row[12], "");
    assert.equal(row[13], "");
    assert.equal(row[14], "");
    assert.equal(row[15], "");
    assert.equal(row[16], "");
    assert.equal(row[17], "");
    assert.equal(row[18], "");
    assert.equal(row[19], "");
    assert.equal(row[20], "2026-07-10");
    assert.equal(row[21], "2026-07-10");
    assert.equal(row[22], "");
    assert.equal(row[CANDIDATE_ID_COLUMN_INDEX], sparse.id);
  });

  it("prefers approvedAt from the candidate object when no second arg", () => {
    const row = mapCandidateRow({
      ...completeCandidate,
      approvedAt: "2026-07-05T10:00:00.000Z",
    });
    assert.equal(row[22], "2026-07-05");
  });
});
