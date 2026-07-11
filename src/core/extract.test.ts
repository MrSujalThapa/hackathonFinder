import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mockCollector } from "@/collectors/mock";
import { extractHackathonEvents } from "./extract";
import { getDefaultDiscoveryPreferences } from "@/agent/parseCommand";

describe("extractHackathonEvents", () => {
  it("extracts structured events from mock leads", async () => {
    const result = await mockCollector.collect({
      preferences: getDefaultDiscoveryPreferences("find upcoming hackathons"),
      maxResults: 25,
      timeoutMs: 15_000,
      dryRun: true,
    });
    const events = extractHackathonEvents(result.leads);
    assert.equal(events.length, result.leads.length);
    assert.ok(events.some((event) => event.name === "HackTO AI Challenge"));
    assert.ok(events[0]?.evidence.length > 0);
  });
});
