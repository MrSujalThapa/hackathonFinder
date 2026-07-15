import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeDiagnosticMessage } from "@/lib/sources/sanitize";

describe("sanitizeDiagnosticMessage", () => {
  it("redacts bearer tokens and api keys", () => {
    const raw =
      "Authorization Bearer sk-live-abc123XYZ and api_key=supersecret SEARCH_API_KEY=tok";
    const cleaned = sanitizeDiagnosticMessage(raw);
    assert.doesNotMatch(cleaned, /sk-live/);
    assert.doesNotMatch(cleaned, /supersecret/);
    assert.match(cleaned, /\[redacted\]/);
  });

  it("redacts browser-profiles path segments", () => {
    const cleaned = sanitizeDiagnosticMessage(
      "failed reading C:\\Users\\me\\.data\\browser-profiles\\hakku\\Default",
    );
    assert.doesNotMatch(cleaned, /Users\\me/);
    assert.match(cleaned, /\[browser-profile\]/);
  });

  it("truncates long messages", () => {
    const cleaned = sanitizeDiagnosticMessage("x".repeat(1000));
    assert.equal(cleaned.length, 400);
  });
});
