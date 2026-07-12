import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeEvidenceUrlKey } from "@/lib/http/evidenceUrl";

/**
 * Unit-level contract for addEvidence identity (no live Supabase).
 * Full repository upsert is covered once migration 005 is applied.
 */
describe("evidence identity contract", () => {
  it("same official URL variants share one key", () => {
    const key = normalizeEvidenceUrlKey(
      "https://mesh.example.com/hackathon?utm_source=agent",
    );
    assert.equal(
      key,
      normalizeEvidenceUrlKey("https://www.mesh.example.com/hackathon/"),
    );
  });

  it("official vs apply remain distinct", () => {
    assert.notEqual(
      normalizeEvidenceUrlKey("https://mesh.example.com/"),
      normalizeEvidenceUrlKey("https://mesh.example.com/apply"),
    );
  });
});
