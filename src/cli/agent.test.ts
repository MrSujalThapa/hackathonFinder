import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAgentArgs } from "@/cli/parseAgentArgs";

describe("parseAgentArgs", () => {
  it("parses command and dry-run flag", () => {
    const options = parseAgentArgs(["node", "agent.ts", "find upcoming hackathons", "--", "--dry-run"]);
    assert.equal(options.command, "find upcoming hackathons");
    assert.equal(options.dryRun, true);
  });

  it("parses sources and max-results flags", () => {
    const options = parseAgentArgs([
      "node",
      "agent.ts",
      "find upcoming hackathons",
      "--",
      "--sources=mock,hacklist",
      "--max-results=20",
      "--dry-run",
    ]);
    assert.deepEqual(options.sources, ["mock", "hacklist"]);
    assert.equal(options.maxResults, 20);
    assert.equal(options.allowMockWrites, false);
  });

  it("parses allow-mock-writes flag", () => {
    const options = parseAgentArgs([
      "node",
      "agent.ts",
      "find upcoming hackathons",
      "--",
      "--sources=mock",
      "--allow-mock-writes",
    ]);
    assert.equal(options.allowMockWrites, true);
    assert.equal(options.dryRun, false);
  });

  it("parses broader discovery sources and rejects unknown names", () => {
    const options = parseAgentArgs([
      "node",
      "agent.ts",
      "find upcoming hackathons",
      "--",
      "--sources=mlh,luma,web",
      "--dry-run",
    ]);
    assert.deepEqual(options.sources, ["mlh", "luma", "web"]);

    assert.throws(
      () =>
        parseAgentArgs([
          "node",
          "agent.ts",
          "find upcoming hackathons",
          "--",
          "--sources=mlh,not-a-source",
        ]),
      /Unknown source\(s\): not-a-source/,
    );
  });

  it("parses show-x-plan flag", () => {
    const options = parseAgentArgs([
      "node",
      "agent.ts",
      "find hackathons on x",
      "--",
      "--sources=x",
      "--show-x-plan",
      "--dry-run",
    ]);
    assert.equal(options.showXPlan, true);
    assert.deepEqual(options.sources, ["x"]);
  });

  it("parses agent mode flags", () => {
    const options = parseAgentArgs([
      "node",
      "agent.ts",
      "find upcoming AI hackathons",
      "--",
      "--agent",
      "--show-agent-plan",
      "--show-agent-trace",
      "--max-agent-calls=5",
      "--dry-run",
    ]);

    assert.equal(options.agent, true);
    assert.equal(options.showAgentPlan, true);
    assert.equal(options.showAgentTrace, true);
    assert.equal(options.maxAgentCalls, 5);
  });

  it("parses review-policy flag", () => {
    const options = parseAgentArgs([
      "node",
      "agent.ts",
      "find upcoming hackathons",
      "--",
      "--review-policy=broad",
      "--dry-run",
    ]);

    assert.equal(options.reviewPolicy, "broad");
  });

  it("rejects simultaneous agent and deterministic flags", () => {
    assert.throws(
      () =>
        parseAgentArgs([
          "node",
          "agent.ts",
          "find upcoming hackathons",
          "--",
          "--agent",
          "--deterministic",
        ]),
      /either --agent or --deterministic/,
    );
  });

  it("rejects malformed and excessive agent runtime flags", () => {
    assert.throws(
      () =>
        parseAgentArgs([
          "node",
          "agent.ts",
          "find upcoming hackathons",
          "--",
          "--max-agent-calls=4]",
        ]),
      /no trailing characters/,
    );

    assert.throws(
      () =>
        parseAgentArgs([
          "node",
          "agent.ts",
          "find upcoming hackathons",
          "--",
          "--max-agent-calls=21",
        ]),
      /<= 20/,
    );
  });
});
