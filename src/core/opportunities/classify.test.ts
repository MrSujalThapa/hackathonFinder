import assert from "node:assert/strict";
import test from "node:test";
import { classifyOpportunityType } from "@/core/opportunities/classify";

test("classifies opportunity types without a model", () => {
  assert.equal(classifyOpportunityType("HackMIT hackathon"), "hackathon");
  assert.equal(classifyOpportunityType("Founder Fellowship 2026"), "fellowship");
  assert.equal(classifyOpportunityType("Toronto AI conference"), "conference");
  assert.equal(classifyOpportunityType("Pre-seed startup accelerator"), "accelerator");
  assert.equal(classifyOpportunityType("Ontario pitch competition"), "pitch_competition");
});
