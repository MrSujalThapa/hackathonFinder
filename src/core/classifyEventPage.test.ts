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

  it("rejects MLH root homepage", () => {
    const result = classifyEventPage({
      name: "Major League Hacking",
      url: "https://mlh.io/",
      description: "The official student hackathon league homepage",
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

  it("rejects Devpost user portfolio pages", () => {
    const result = classifyEventPage({
      name: "Jane Builder's software portfolio - Devpost",
      url: "https://devpost.com/jane-builder",
      description: "View Jane Builder's hackathon projects, achievements, and followers",
    });
    assert.notEqual(result.classification, "INDIVIDUAL_EVENT");
  });

  it("rejects Luma calendar pages", () => {
    const result = classifyEventPage({
      name: "Events Calendar",
      url: "https://lu.ma/calendar/cal-abc123",
      description: "Browse upcoming events from this calendar",
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

  it("does not accept generic Facebook social pages as events", () => {
    const result = classifyEventPage({
      name: "Facebook",
      url: "https://www.facebook.com/",
      description: "Log into Facebook to start sharing and connecting with your friends",
      text: "Facebook helps you connect and share with the people in your life.",
    });
    assert.notEqual(result.classification, "INDIVIDUAL_EVENT");
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

  it("accepts an actual Luma hackathon event page", () => {
    const result = classifyEventPage({
      name: "AI Builders Hackathon",
      url: "https://lu.ma/ai-builders-hackathon",
      description: "Join builders for a remote AI hackathon. Register before August 1.",
      startDate: "2026-08-21",
      location: "Remote",
      mode: "online",
      applyUrl: "https://lu.ma/ai-builders-hackathon",
    });
    assert.equal(result.classification, "INDIVIDUAL_EVENT");
  });

  it("accepts an actual Devpost hackathon page", () => {
    const result = classifyEventPage({
      name: "Open Source AI Hackathon",
      url: "https://open-source-ai-hackathon.devpost.com/",
      description: "Build AI tools, submit on Devpost, and register for the online hackathon.",
      startDate: "2026-11-05",
      deadline: "2026-10-20",
      location: "Online",
      mode: "online",
      applyUrl: "https://open-source-ai-hackathon.devpost.com/",
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
