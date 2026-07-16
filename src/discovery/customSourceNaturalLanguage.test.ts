import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchCustomSourcesInNaturalLanguage } from "@/discovery/customSourceNaturalLanguage";

const RESKILLL = { id: "1", slug: "reskilll", name: "Reskilll" };
const SPACE = { id: "2", slug: "hackathons-space", name: "hackathons.space" };
const CATALOG = [RESKILLL, SPACE];

describe("custom source natural-language restriction", () => {
  it("resolves from Reskilll exclusively to custom:reskilll", () => {
    const matched = matchCustomSourcesInNaturalLanguage(
      "find upcoming hackathons from Reskilll in the next 12 months",
      CATALOG,
    );
    assert.deepEqual(
      matched.map((source) => source.slug),
      ["reskilll"],
    );
  });

  it("resolves another custom source name exclusively", () => {
    const matched = matchCustomSourcesInNaturalLanguage(
      "find hackathons from hackathons.space",
      CATALOG,
    );
    assert.deepEqual(
      matched.map((source) => source.slug),
      ["hackathons-space"],
    );
  });

  it("leaves unknown source names unresolved", () => {
    const matched = matchCustomSourcesInNaturalLanguage(
      "find hackathons from TotallyUnknownDirectory",
      CATALOG,
    );
    assert.deepEqual(matched, []);
  });

  it("does not invent built-in sources from custom mention matching", () => {
    const matched = matchCustomSourcesInNaturalLanguage(
      "find hackathons from Reskilll and Devpost",
      CATALOG,
    );
    assert.deepEqual(
      matched.map((source) => source.slug),
      ["reskilll"],
    );
    assert.ok(!matched.some((source) => source.slug === "devpost"));
  });
});
