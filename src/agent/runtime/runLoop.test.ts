import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { runLoop } from "./runLoop";
import { createToolRegistry } from "./toolRegistry";
import type { AgentTool } from "./types";

describe("runLoop", () => {
  it("executes an inspectable static plan", async () => {
    const tool: AgentTool<{ value: string }, { value: string }> = {
      name: "echo",
      description: "Echo for tests.",
      schema: z.object({ value: z.string() }),
      execute(args) {
        return args;
      },
    };

    const result = await runLoop({
      registry: createToolRegistry([tool]),
      plan: {
        id: "test-plan",
        toolCalls: [{ id: "echo-1", name: "echo", args: { value: "hello" } }],
      },
    });

    assert.equal(result.status, "completed");
    assert.equal(result.plan.id, "test-plan");
    assert.equal(result.toolResults.length, 1);
    assert.ok(result.runtime.trace.some((event) => event.type === "tool_succeeded"));
  });

  it("stops when the loop cap is reached", async () => {
    const tool: AgentTool<Record<string, never>, { ok: true }> = {
      name: "next",
      description: "Next for tests.",
      schema: z.object({}),
      execute() {
        return { ok: true };
      },
    };

    const result = await runLoop({
      registry: createToolRegistry([tool]),
      limits: { maxLoops: 1 },
      plan: {
        id: "loop-plan",
        toolCalls: [{ id: "next-1", name: "next", args: {} }],
      },
      planner() {
        return [{ id: "next-2", name: "next", args: { again: true } }];
      },
    });

    assert.equal(result.status, "stopped");
    assert.match(result.stopReason ?? "", /Loop limit 1/);
    assert.equal(result.runtime.loopCount, 1);
    assert.ok(result.runtime.trace.some((event) => event.type === "loop_limit_reached"));
  });
});
