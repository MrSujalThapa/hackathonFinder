import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AGENT_TOOL_NAMES } from "@/agent/runtime/tools";
import { parseIntent } from "./parseIntent";
import { planDiscovery } from "./planDiscovery";

describe("planDiscovery", () => {
  it("plans inspectable deterministic discovery tool calls", () => {
    const intent = parseIntent("find upcoming hackathons in Toronto on x");
    const plan = planDiscovery(intent, { dryRunPlan: true, includeParseTool: true });

    assert.equal(plan.toolCalls.at(-1)?.name, AGENT_TOOL_NAMES.finalizeDiscoveryPlan);
    assert.ok(
      !plan.toolCalls.some((call) => call.name === AGENT_TOOL_NAMES.collectX),
    );
    assert.deepEqual(
      (plan.toolCalls.at(-1)?.args as { selectedSources: string[] }).selectedSources,
      ["x"],
    );
  });

  it("adds collector execution by default with dry-run collectors", () => {
    const intent = parseIntent("find upcoming hackathons in Toronto");
    const plan = planDiscovery(intent);
    const collect = plan.toolCalls.find(
      (call) => call.name === AGENT_TOOL_NAMES.collectHacklist,
    );

    assert.ok(collect);
    assert.equal((collect.args as { dryRun?: boolean }).dryRun, true);
  });

  it("does not plan tools for unknown intent", () => {
    const intent = parseIntent("show me saved candidates");
    const plan = planDiscovery(intent);

    assert.equal(plan.toolCalls.length, 0);
    assert.match(plan.summary, /unknown intent/i);
  });
});
