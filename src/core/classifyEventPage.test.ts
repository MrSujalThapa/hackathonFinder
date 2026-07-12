import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyEventPage } from "@/core/classifyEventPage";

describe("classifyEventPage", () => {
  it("rejects MLH homepage / season listing", () => {
    const result = classifyEventPage({
      name: "Major League Hacking",
      url: "https://www.mlh.com/seasons/2027/events",
      description: "Upcoming hackathons on the MLH season schedule",
    });
    assert.equal(result.classification, "EVENT_DIRECTORY");
  });

  it("rejects Devpost AI category page", () => {
    const result = classifyEventPage({
      name: "Machine Learning/AI",
      url: "https://devpost.com/hackathons?challenge_type=online&themes[]=machine-learning-ai",
      description: "Browse AI hackathons on Devpost",
    });
    assert.equal(result.classification, "EVENT_DIRECTORY");
  });

  it("rejects Lablab hackathon directory", () => {
    const result = classifyEventPage({
      name: "AI Hackathons - Lablab.ai",
      url: "https://lablab.ai/ai-hackathons",
      description: "Browse AI hackathons",
    });
    assert.equal(result.classification, "EVENT_DIRECTORY");
  });

  it("rejects Eventbrite Canada results page", () => {
    const result = classifyEventPage({
      name: "Hackathon Events in Canada",
      url: "https://www.eventbrite.ca/d/canada/hackathon/",
      description: "Find hackathon events near you",
    });
    assert.equal(result.classification, "EVENT_DIRECTORY");
  });

  it("accepts an actual individual event page", () => {
    const result = classifyEventPage({
      name: "Hack the North 2026",
      url: "https://hackthenorth.com/",
      description: "Canada's biggest hackathon. Apply now for the Waterloo weekend.",
      startDate: "2026-09-12",
      endDate: "2026-09-14",
      deadline: "2026-08-01",
      location: "Waterloo, Canada",
      mode: "in-person",
      applyUrl: "https://hackthenorth.com/apply",
      officialUrl: "https://hackthenorth.com/",
    });
    assert.equal(result.classification, "INDIVIDUAL_EVENT");
  });

  it("flags articles", () => {
    const result = classifyEventPage({
      name: "What is a hackathon?",
      url: "https://example.com/blog/what-is-a-hackathon",
      description: "Tips for beginners and how to win",
    });
    assert.equal(result.classification, "ARTICLE");
  });
});
