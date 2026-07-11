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
  });
});
