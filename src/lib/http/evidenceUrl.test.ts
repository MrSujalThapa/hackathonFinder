import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeEvidenceUrlKey } from "@/lib/http/evidenceUrl";

describe("normalizeEvidenceUrlKey", () => {
  it("collapses trailing slash and fragment differences", () => {
    assert.equal(
      normalizeEvidenceUrlKey("https://Example.com/event/"),
      normalizeEvidenceUrlKey("https://www.example.com/event#section"),
    );
  });

  it("strips utm and tracking params but keeps meaningful query", () => {
    const a = normalizeEvidenceUrlKey(
      "https://example.com/apply?utm_source=x&id=42&utm_campaign=spring",
    );
    const b = normalizeEvidenceUrlKey("https://example.com/apply?id=42");
    assert.equal(a, b);
    assert.match(a, /id=42/);
    assert.ok(!a.includes("utm_"));
  });

  it("sorts query params for stable identity", () => {
    assert.equal(
      normalizeEvidenceUrlKey("https://example.com/x?b=2&a=1"),
      normalizeEvidenceUrlKey("https://example.com/x?a=1&b=2"),
    );
  });

  it("does not merge genuinely distinct URLs", () => {
    assert.notEqual(
      normalizeEvidenceUrlKey("https://example.com/apply"),
      normalizeEvidenceUrlKey("https://example.com/official"),
    );
    assert.notEqual(
      normalizeEvidenceUrlKey("https://example.com/apply?id=1"),
      normalizeEvidenceUrlKey("https://example.com/apply?id=2"),
    );
  });

  it("maps missing URLs to empty key", () => {
    assert.equal(normalizeEvidenceUrlKey(null), "");
    assert.equal(normalizeEvidenceUrlKey(undefined), "");
    assert.equal(normalizeEvidenceUrlKey("  "), "");
  });
});
