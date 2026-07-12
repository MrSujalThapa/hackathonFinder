import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getRegisteredSources,
  parseSourcesFlag,
  resolveCollectors,
} from "@/collectors/registry";

describe("collector registry", () => {
  it("registers mock and real collectors including broader discovery sources", () => {
    const sources = getRegisteredSources();
    assert.ok(sources.includes("mock"));
    assert.ok(sources.includes("hacklist"));
    assert.ok(sources.includes("hakku"));
    assert.ok(sources.includes("devpost"));
    assert.ok(sources.includes("mlh"));
    assert.ok(sources.includes("luma"));
    assert.ok(sources.includes("web"));
    assert.ok(sources.includes("x"));
  });

  it("parses --sources flag values", () => {
    const sources = parseSourcesFlag("mock,hacklist,mlh,luma,web,x");
    assert.deepEqual(sources, ["mock", "hacklist", "mlh", "luma", "web", "x"]);
  });

  it("maps twitter CLI alias to x", () => {
    assert.deepEqual(parseSourcesFlag("twitter"), ["x"]);
    assert.deepEqual(parseSourcesFlag("hacklist,twitter,web"), ["hacklist", "x", "web"]);
  });

  it("rejects unknown sources with a useful error", () => {
    assert.throws(
      () => parseSourcesFlag("hacklist,unknown,devpost"),
      /Unknown source\(s\): unknown/,
    );
  });

  it("resolves collectors in request order without duplicates", () => {
    const collectors = resolveCollectors(["mock", "hacklist", "mock", "mlh", "web"]);
    assert.deepEqual(
      collectors.map((collector) => collector.source),
      ["mock", "hacklist", "mlh", "web"],
    );
  });
});
