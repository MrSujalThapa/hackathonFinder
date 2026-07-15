import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HEALTHABLE_SOURCES,
  isHealthableSource,
  assertHealthableSource,
} from "@/lib/sources/types";
import { SOURCE_CAPABILITIES, SOURCE_DISPLAY_NAMES } from "@/lib/sources/config";

describe("healthable sources contract", () => {
  it("excludes x and mock from default health set", () => {
    assert.ok(!HEALTHABLE_SOURCES.includes("x" as never));
    assert.ok(!HEALTHABLE_SOURCES.includes("mock" as never));
    assert.deepEqual([...HEALTHABLE_SOURCES], [
      "mlh",
      "web",
      "hacklist",
      "devpost",
      "luma",
      "hakku",
    ]);
  });

  it("provides display names and capabilities for every healthable source", () => {
    for (const source of HEALTHABLE_SOURCES) {
      assert.ok(SOURCE_DISPLAY_NAMES[source]);
      assert.equal(typeof SOURCE_CAPABILITIES[source].publicDiscovery, "boolean");
      assert.equal(typeof SOURCE_CAPABILITIES[source].browserRequired, "boolean");
    }
    assert.equal(SOURCE_CAPABILITIES.hakku.browserRequired, true);
    assert.equal(SOURCE_CAPABILITIES.luma.publicDiscovery, true);
    assert.equal(SOURCE_CAPABILITIES.luma.authenticatedDiscovery, false);
  });

  it("guards unknown source names", () => {
    assert.equal(isHealthableSource("mlh"), true);
    assert.equal(isHealthableSource("x"), false);
    assert.throws(() => assertHealthableSource("x"));
  });
});
