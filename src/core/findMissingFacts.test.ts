import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HackathonEvent } from "@/core/discovery/types";
import { findMissingFacts } from "@/core/findMissingFacts";

describe("findMissingFacts", () => {
  it("prioritizes required official, apply, and date facts", () => {
    const event: HackathonEvent = {
      name: "Sparse Hackathon",
      source: "x",
      socialUrl: "https://x.com/org/status/1",
      location: "Toronto",
      city: "Toronto",
      country: "Canada",
      themes: [],
      evidence: [],
    };

    const missing = findMissingFacts(event, { themes: ["AI"], locations: ["Toronto"], includeRemote: false });

    assert.deepEqual(missing.slice(0, 3).map((fact) => fact.kind), [
      "officialUrl",
      "applyUrl",
      "deadline",
    ]);
    assert.equal(missing[0]?.required, true);
    assert.ok(missing.some((fact) => fact.kind === "themes"));
  });

  it("does not require a physical location for online events", () => {
    const event: HackathonEvent = {
      name: "Remote Hack",
      source: "web",
      officialUrl: "https://remote.example",
      applyUrl: "https://remote.example/apply",
      startDate: "2026-09-01",
      mode: "online",
      themes: ["AI"],
      evidence: [],
    };

    const missing = findMissingFacts(event);
    assert.equal(missing.some((fact) => fact.kind === "location"), false);
    assert.equal(missing.some((fact) => fact.kind === "deadline"), true);
  });
});
