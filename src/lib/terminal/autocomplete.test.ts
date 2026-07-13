import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyAutocomplete,
  cycleAutocomplete,
  getAutocompleteSuggestions,
} from "@/lib/terminal/autocomplete";

describe("getAutocompleteSuggestions", () => {
  it("suggests slash commands from a slash prefix", () => {
    const suggestions = getAutocompleteSuggestions("/so");
    assert.ok(suggestions.includes("/sources"));
    assert.ok(suggestions.includes("/source"));
  });

  it("suggests source actions after /source", () => {
    const suggestions = getAutocompleteSuggestions("/source ");
    assert.ok(suggestions.includes("status"));
    assert.ok(suggestions.includes("connect"));
    assert.ok(suggestions.includes("disconnect"));
  });

  it("suggests source names after /source status", () => {
    const suggestions = getAutocompleteSuggestions("/source status hakk");
    assert.deepEqual(suggestions, ["hakku"]);
  });

  it("suggests help topics", () => {
    const suggestions = getAutocompleteSuggestions("/help ");
    assert.ok(suggestions.includes("find"));
    assert.ok(suggestions.includes("source"));
    assert.ok(suggestions.includes("terminals"));
  });

  it("suggests terminal names for switch", () => {
    const suggestions = getAutocompleteSuggestions("/switch ", undefined, {
      terminalNames: ["research", "canada-ai"],
    });
    assert.ok(suggestions.includes("research"));
    assert.ok(suggestions.includes("canada-ai"));
    assert.ok(suggestions.includes("terminal"));
  });

  it("suggests job ids for cancel", () => {
    const suggestions = getAutocompleteSuggestions("/cancel job_a", undefined, {
      recentJobIds: ["job_abc", "job_xyz"],
    });
    assert.deepEqual(suggestions, ["job_abc"]);
  });

  it("cycles suggestions with Tab semantics", () => {
    const first = cycleAutocomplete("/so", 3, {}, 0);
    assert.ok(first);
    assert.ok(first.suggestions.length >= 2);
    const second = cycleAutocomplete("/so", 3, {}, 1);
    assert.ok(second);
    assert.notEqual(first.value, second.value);
  });

  it("applies a suggestion replacing the current token", () => {
    const applied = applyAutocomplete("/source st", "status");
    assert.equal(applied.value, "/source status ");
  });
});
