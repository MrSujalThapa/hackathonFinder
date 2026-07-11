import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getRegisteredSources,
  parseSourcesFlag,
  resolveCollectors,
} from "@/collectors/registry";

describe("collector registry", () => {
  it("registers mock and real collectors", () => {
    const sources = getRegisteredSources();
    assert.ok(sources.includes("mock"));
    assert.ok(sources.includes("hacklist"));
    assert.ok(sources.includes("hakku"));
    assert.ok(sources.includes("devpost"));
  });

  it("parses --sources flag values", () => {
    const sources = parseSourcesFlag("mock,hacklist,devpost,hakku");
    assert.deepEqual(sources, ["mock", "hacklist", "devpost", "hakku"]);
  });

  it("ignores unknown sources", () => {
    const sources = parseSourcesFlag("hacklist,unknown,devpost");
    assert.deepEqual(sources, ["hacklist", "devpost"]);
  });

  it("resolves collectors in request order without duplicates", () => {
    const collectors = resolveCollectors(["mock", "hacklist", "mock", "devpost"]);
    assert.deepEqual(
      collectors.map((collector) => collector.source),
      ["mock", "hacklist", "devpost"],
    );
  });
});
