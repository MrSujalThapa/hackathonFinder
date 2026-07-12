import { normalizeRuntimeLimits, type AgentRuntimeLimits } from "./limits";
import { createTraceRecorder, type AgentTraceRecorder } from "./trace";
import type { AgentRuntimeSnapshot, AgentTraceEventInput } from "./types";

export type AgentRuntimeState = {
  startedAtMs: number;
  limits: AgentRuntimeLimits;
  requestId?: string;
  loopCount: number;
  toolCallCount: number;
  seenToolCalls: Set<string>;
  cache: Map<string, unknown>;
  trace: AgentTraceRecorder;
};

export function createAgentRuntimeState(options: {
  limits?: Partial<AgentRuntimeLimits>;
  requestId?: string;
  nowMs?: number;
} = {}): AgentRuntimeState {
  const state: AgentRuntimeState = {
    startedAtMs: options.nowMs ?? Date.now(),
    limits: normalizeRuntimeLimits(options.limits),
    requestId: options.requestId,
    loopCount: 0,
    toolCallCount: 0,
    seenToolCalls: new Set<string>(),
    cache: new Map<string, unknown>(),
    trace: createTraceRecorder(),
  };

  state.trace.add({
    type: "run_started",
    message: "Agent runtime started.",
    data: { requestId: options.requestId },
  });

  return state;
}

export function addTrace(state: AgentRuntimeState, event: AgentTraceEventInput): void {
  state.trace.add(event);
}

export function snapshotRuntimeState(state: AgentRuntimeState): AgentRuntimeSnapshot {
  return {
    startedAt: new Date(state.startedAtMs).toISOString(),
    elapsedMs: Date.now() - state.startedAtMs,
    loopCount: state.loopCount,
    toolCallCount: state.toolCallCount,
    cacheKeys: [...state.cache.keys()],
    trace: state.trace.events(),
  };
}
