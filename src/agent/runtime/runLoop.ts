import { executeTool } from "./executeTool";
import { hasRuntimeTimeRemaining } from "./limits";
import { createAgentRuntimeState, snapshotRuntimeState, type AgentRuntimeState } from "./state";
import { createDefaultToolRegistry, type AgentToolRegistry } from "./toolRegistry";
import type { AgentRuntimeLimits } from "./limits";
import type { AgentRuntimeSnapshot, AgentToolCall, AgentToolResult } from "./types";

export type AgentRunPlan = {
  id?: string;
  description?: string;
  toolCalls: AgentToolCall[];
};

export type AgentLoopPlanner = (input: {
  state: AgentRuntimeState;
  previousResults: AgentToolResult[];
}) => Promise<AgentToolCall[]> | AgentToolCall[];

export type AgentRunLoopResult = {
  status: "completed" | "stopped";
  plan: AgentRunPlan;
  toolResults: AgentToolResult[];
  runtime: AgentRuntimeSnapshot;
  stopReason?: string;
};

export async function runLoop(options: {
  plan: AgentRunPlan;
  registry?: AgentToolRegistry;
  limits?: Partial<AgentRuntimeLimits>;
  requestId?: string;
  planner?: AgentLoopPlanner;
}): Promise<AgentRunLoopResult> {
  const registry = options.registry ?? createDefaultToolRegistry();
  const state = createAgentRuntimeState({
    limits: options.limits,
    requestId: options.requestId ?? options.plan.id,
  });
  const toolResults: AgentToolResult[] = [];
  let nextCalls = [...options.plan.toolCalls];
  let stopReason: string | undefined;

  while (nextCalls.length > 0) {
    if (state.loopCount >= state.limits.maxLoops) {
      stopReason = `Loop limit ${state.limits.maxLoops} reached.`;
      state.trace.add({
        type: "loop_limit_reached",
        message: stopReason,
      });
      break;
    }

    if (!hasRuntimeTimeRemaining(state.startedAtMs, state.limits)) {
      stopReason = `Runtime exceeded ${state.limits.maxElapsedMs}ms.`;
      break;
    }

    state.loopCount += 1;
    state.trace.add({
      type: "loop_started",
      message: `Starting loop ${state.loopCount}.`,
      data: { plannedCalls: nextCalls.length },
    });

    const loopResults: AgentToolResult[] = [];
    for (const call of nextCalls) {
      const result = await executeTool({ state, registry, call });
      loopResults.push(result);
      toolResults.push(result);

      if (!result.ok && (result.error.code === "TIME_LIMIT" || result.error.code === "TOOL_CALL_LIMIT")) {
        stopReason = result.error.message;
        break;
      }
    }

    state.trace.add({
      type: "loop_completed",
      message: `Completed loop ${state.loopCount}.`,
      data: { results: loopResults.length },
    });

    if (stopReason || !options.planner) {
      break;
    }

    nextCalls = await options.planner({ state, previousResults: loopResults });
  }

  const status = stopReason ? "stopped" : "completed";
  state.trace.add({
    type: "run_completed",
    message: status === "completed" ? "Agent runtime completed." : stopReason,
    data: { status },
  });

  return {
    status,
    plan: options.plan,
    toolResults,
    runtime: snapshotRuntimeState(state),
    stopReason,
  };
}
