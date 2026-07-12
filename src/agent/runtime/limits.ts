export type AgentRuntimeLimits = {
  maxLoops: number;
  maxToolCalls: number;
  maxElapsedMs: number;
  perToolTimeoutMs: number;
};

export const DEFAULT_AGENT_RUNTIME_LIMITS: AgentRuntimeLimits = {
  maxLoops: 4,
  maxToolCalls: 8,
  maxElapsedMs: 30_000,
  perToolTimeoutMs: 15_000,
};

export function normalizeRuntimeLimits(
  limits: Partial<AgentRuntimeLimits> = {},
): AgentRuntimeLimits {
  return {
    ...DEFAULT_AGENT_RUNTIME_LIMITS,
    ...limits,
  };
}

export function hasRuntimeTimeRemaining(startedAtMs: number, limits: AgentRuntimeLimits): boolean {
  return Date.now() - startedAtMs < limits.maxElapsedMs;
}

export function remainingRuntimeMs(startedAtMs: number, limits: AgentRuntimeLimits): number {
  return Math.max(0, limits.maxElapsedMs - (Date.now() - startedAtMs));
}
