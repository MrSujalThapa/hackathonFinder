import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupCandidateEvidence,
  selectPrimaryEvidenceGroups,
} from "@/lib/candidates/evidenceGroups";
import type { CandidateEvidence } from "@/core/candidates/types";

function ev(
  partial: Partial<CandidateEvidence> & Pick<CandidateEvidence, "id" | "type">,
): CandidateEvidence {
  return {
    candidateId: "c1",
    url: partial.url ?? null,
    title: partial.title ?? null,
    snippet: partial.snippet ?? null,
    raw: {},
    foundAt: partial.foundAt ?? "2026-07-01T00:00:00Z",
    seenCount: partial.seenCount ?? 1,
    lastSeenAt: partial.lastSeenAt,
    ...partial,
  };
}

describe("evidenceGroups", () => {
  it("groups by type and normalized URL and sums seen counts", () => {
    const groups = groupCandidateEvidence([
      ev({
        id: "1",
        type: "official_page",
        url: "https://mesh.example.com/hack?utm_source=x",
        title: "Mesh API Hackathon",
        seenCount: 2,
      }),
      ev({
        id: "2",
        type: "official_page",
        url: "https://www.mesh.example.com/hack/",
        title: "Mesh API Hackathon",
        seenCount: 3,
      }),
      ev({
        id: "3",
        type: "apply_page",
        url: "https://mesh.example.com/apply",
        title: "Mesh API Hackathon apply",
      }),
    ]);
    assert.equal(groups.length, 2);
    const official = groups.find((g) => g.type === "official_page");
    assert.ok(official);
    assert.equal(official.seenCount, 5);
    assert.ok(official.authority > 50);
  });

  it("selects a short primary list", () => {
    const groups = groupCandidateEvidence([
      ev({ id: "1", type: "official_page", url: "https://a.example/1", title: "A" }),
      ev({ id: "2", type: "apply_page", url: "https://a.example/apply", title: "Apply" }),
      ev({ id: "3", type: "x_post", url: "https://x.com/a/status/1", title: "Post" }),
      ev({ id: "4", type: "search_result", url: "https://b.example", title: "B" }),
      ev({ id: "5", type: "hacklist_card", url: "https://c.example", title: "C" }),
      ev({ id: "6", type: "manual_lead", url: "https://d.example", title: "D" }),
    ]);
    const { primary, rest } = selectPrimaryEvidenceGroups(groups, 3);
    assert.equal(primary.length, 3);
    assert.equal(rest.length, 3);
  });
});
