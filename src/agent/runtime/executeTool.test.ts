import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { createAgentRuntimeState } from "./state";
import { createToolRegistry } from "./toolRegistry";
import { executeTool } from "./executeTool";
import type { AgentTool } from "./types";

describe("executeTool", () => {
  it("denies unknown tools by default", async () => {
    const state = createAgentRuntimeState();
    const registry = createToolRegistry();

    const result = await executeTool({
      state,
      registry,
      call: { name: "not_registered", args: {} },
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "UNKNOWN_TOOL");
    }
  });

  it("returns cached results for duplicate calls without re-executing", async () => {
    let executions = 0;
    const tool: AgentTool<{ value: string }, { value: string; executions: number }> = {
      name: "echo",
      description: "Echo for tests.",
      schema: z.object({ value: z.string() }),
      execute(args) {
        executions += 1;
        return { value: args.value, executions };
      },
    };
    const state = createAgentRuntimeState();
    const registry = createToolRegistry([tool]);
    const call = { name: "echo", args: { value: "same" } };

    const first = await executeTool({ state, registry, call });
    const second = await executeTool({ state, registry, call });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(executions, 1);
    assert.equal(second.cached, true);
    assert.equal(second.duplicate, true);
    assert.equal(state.toolCallCount, 1);
  });

  it("caps non-cached tool calls", async () => {
    const tool: AgentTool<{ value: string }, { value: string }> = {
      name: "echo",
      description: "Echo for tests.",
      schema: z.object({ value: z.string() }),
      execute(args) {
        return args;
      },
    };
    const state = createAgentRuntimeState({ limits: { maxToolCalls: 1 } });
    const registry = createToolRegistry([tool]);

    const first = await executeTool({
      state,
      registry,
      call: { name: "echo", args: { value: "one" } },
    });
    const second = await executeTool({
      state,
      registry,
      call: { name: "echo", args: { value: "two" } },
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.error.code, "TOOL_CALL_LIMIT");
    }
  });

  it("validates tool arguments before execution", async () => {
    let executions = 0;
    const tool: AgentTool<{ value: string }, { value: string }> = {
      name: "echo",
      description: "Echo for tests.",
      schema: z.object({ value: z.string() }),
      execute(args) {
        executions += 1;
        return args;
      },
    };
    const state = createAgentRuntimeState();
    const registry = createToolRegistry([tool]);

    const result = await executeTool({
      state,
      registry,
      call: { name: "echo", args: { value: 123 } },
    });

    assert.equal(result.ok, false);
    assert.equal(executions, 0);
    if (!result.ok) {
      assert.equal(result.error.code, "INVALID_ARGS");
    }
  });
});
