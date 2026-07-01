import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mockCollector } from "@/collectors/mock";
import { extractHackathonEvents } from "./extract";
import { verifyHackathonEvent } from "./verify";
import { getDefaultDiscoveryPreferences } from "@/agent/parseCommand";

describe("verifyHackathonEvent", () => {
  it("rejects past and social-only leads with appropriate status", async () => {
    const leads = await mockCollector.collect(
      getDefaultDiscoveryPreferences("find upcoming hackathons"),
    );
    const events = extractHackathonEvents(leads);
    const past = events.find((event) => event.name === "Past Hackathon");
    const social = events.find((event) => event.name === "Maybe a hackathon?");
    const strong = events.find((event) => event.name === "HackTO AI Challenge");

    assert.ok(past);
    assert.ok(social);
    assert.ok(strong);

    assert.equal(verifyHackathonEvent(past).status, "rejected");
    assert.equal(verifyHackathonEvent(social).status, "needs_review");
    assert.equal(verifyHackathonEvent(strong).status, "accepted");
  });
});
