import type { CandidateCard } from "@/core/candidates/types";

/** Visual fixture for card layout development before mock/live wiring. */
export const PREVIEW_CANDIDATE: CandidateCard = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "NEW",
  score: 86,
  name: "HackTO AI Challenge",
  summary:
    "Toronto AI hackathon focused on agents and cloud tooling. Build something useful in a weekend.",
  source: "hacklist",
  officialUrl: "https://hackto.example.com/ai-challenge",
  applyUrl: "https://hackto.example.com/ai-challenge/apply",
  socialUrl: null,
  startDate: "2026-09-13",
  endDate: "2026-09-15",
  deadline: "2026-08-15",
  location: "Toronto, Canada",
  mode: "in-person",
  city: "Toronto",
  country: "Canada",
  prize: "$10,000 in prizes",
  themes: ["AI", "agents", "cloud"],
  eligibility: "Open to students and professionals in Canada",
  whyMatch: ["Matches AI theme preference", "Toronto location"],
  redFlags: [],
  foundAt: "2026-07-01T12:00:00.000Z",
  lastVerified: "2026-07-01T12:00:00.000Z",
  approvedAt: null,
  sheetRowId: null,
  sheetAppendedAt: null,
};
