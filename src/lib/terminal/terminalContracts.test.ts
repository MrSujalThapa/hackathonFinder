import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCommand } from "@/agent/parseCommand";
import { formatTerminalCandidateResult } from "@/lib/terminal/formatEvent";
import { parseTerminalCommand } from "@/lib/terminal/parseCommand";
import {
  formatQueryInterpretationLines,
  interpretDiscoveryQuery,
} from "@/lib/terminal/queryInterpretation";

describe("terminal production contracts", () => {
  it("separates flags from planner/search text", () => {
    const parsed = parseTerminalCommand(
      "find upcoming AI hackathons in Toronto --profile light --include-remote --dry-run --verbose",
    );
    assert.equal(parsed.kind, "find");
    if (parsed.kind !== "find") return;
    assert.equal(parsed.request, "upcoming AI hackathons in Toronto");
    assert.equal(parsed.profile, "light");
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.verbose, true);
    assert.equal(parsed.remotePolicy, "include");
    assert.equal(parsed.request.includes("--profile"), false);
  });

  it("wires crawl profiles into visible interpretation", () => {
    const parsed = parseTerminalCommand(
      "find upcoming AI hackathons in Toronto --profile deep --dry-run",
    );
    assert.equal(parsed.kind, "find");
    if (parsed.kind !== "find") return;
    const interpretation = interpretDiscoveryQuery({
      request: parsed.request,
      profile: parsed.profile,
      dryRun: parsed.dryRun,
      remotePolicy: parsed.remotePolicy,
    });
    assert.equal(interpretation.crawlProfile, "deep");
    assert.equal(interpretation.dryRun, true);
    assert.match(interpretation.budgets.devpost, /target ≥300/);
    assert.match(interpretation.budgets.devpost, /max 500 cards/);
    assert.match(interpretation.budgets.luma, /target ≥100/);
    assert.match(interpretation.budgets.luma, /max 400 events/);
    const lines = formatQueryInterpretationLines(interpretation);
    assert.ok(lines.some((line) => line.includes("Profile: deep")));
    assert.ok(lines.some((line) => line.includes("Remote: excluded")));
  });

  it("does not silently reinterpret a city-only query as including remote", () => {
    const preferences = parseCommand("upcoming AI hackathons in Toronto");
    assert.equal(preferences.locationConstraint, "event_location");
    assert.equal(preferences.remotePolicy, "exclude");
    assert.equal(preferences.includeRemote, false);
  });

  it("parses source restriction commands", () => {
    const parsed = parseTerminalCommand(
      "find AI hackathons from Devpost in the next 6 months --profile deep --dry-run",
    );
    assert.equal(parsed.kind, "find");
    if (parsed.kind !== "find") return;
    const preferences = parseCommand(parsed.request);
    assert.ok(preferences.sources.includes("devpost"));
  });

  it("formats distinct application and submission deadlines", () => {
    const text = formatTerminalCandidateResult({
      name: "OpenAI Build Week",
      eventStartDate: "2026-07-13",
      eventEndDate: "2026-07-21",
      applicationDeadline: undefined,
      deadlineState: "missing",
      submissionDeadline: "2026-07-21T17:00:00-07:00",
      location: "Online",
      participationMode: "remote",
      eligibility: "See official rules",
      themes: ["AI", "DevOps"],
      status: "NEEDS_REVIEW",
      source: "devpost",
      evidenceSummary: "Official listing + official dates page",
    });
    assert.match(text, /Applications close: Not publicly listed/);
    assert.match(text, /Submissions close: 2026-07-21/);
    assert.doesNotMatch(text, /Applications close: 2026-07-21/);
  });
});
