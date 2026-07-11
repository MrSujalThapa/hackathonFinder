import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertCompatibleHeaders,
  SHEET_HEADERS,
} from "@/server/sheets/schema";

describe("assertCompatibleHeaders", () => {
  it("accepts empty headers", () => {
    assert.equal(assertCompatibleHeaders([]).ok, true);
    assert.equal(assertCompatibleHeaders(["", "  "]).ok, true);
  });

  it("accepts exact SHEET_HEADERS", () => {
    assert.equal(assertCompatibleHeaders([...SHEET_HEADERS]).ok, true);
  });

  it("rejects wrong length or wrong labels", () => {
    const wrongLength = assertCompatibleHeaders(["Status", "Score"]);
    assert.equal(wrongLength.ok, false);

    const wrongLabel = [...SHEET_HEADERS] as string[];
    wrongLabel[0] = "STATE";
    const result = assertCompatibleHeaders(wrongLabel);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message, /column 1/i);
    }
  });
});
