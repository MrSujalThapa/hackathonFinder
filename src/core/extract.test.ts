import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mockCollector } from "@/collectors/mock";
import { extractHackathonEvents } from "./extract";
import { getDefaultDiscoveryPreferences } from "@/agent/parseCommand";

describe("extractHackathonEvents", () => {
  it("extracts structured events from mock leads", async () => {
    const leads = await mockCollector.collect(
      getDefaultDiscoveryPreferences("find upcoming hackathons"),
    );
    const events = extractHackathonEvents(leads);
    assert.equal(events.length, leads.length);
    assert.ok(events.some((event) => event.name === "HackTO AI Challenge"));
    assert.ok(events[0]?.evidence.length > 0);
  });
});
