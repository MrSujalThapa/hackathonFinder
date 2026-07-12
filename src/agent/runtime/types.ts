import type { z } from "zod";
import type { AgentRuntimeLimits } from "./limits";

export type AgentToolCall = {
  id?: string;
  name: string;
  args: unknown;
};

export type AgentToolErrorCode =
  | "UNKNOWN_TOOL"
  | "INVALID_ARGS"
  | "DUPLICATE_TOOL_CALL"
  | "TOOL_CALL_LIMIT"
  | "TIME_LIMIT"
  | "TOOL_TIMEOUT"
  | "TOOL_ERROR";

export type AgentToolError = {
  code: AgentToolErrorCode;
  message: string;
};

export type AgentToolResult =
  | {
      ok: true;
      call: AgentToolCall;
      result: unknown;
      cached: boolean;
      duplicate: boolean;
      durationMs: number;
    }
  | {
      ok: false;
      call: AgentToolCall;
      error: AgentToolError;
      cached: boolean;
      duplicate: boolean;
      durationMs: number;
    };

export type AgentToolContext = {
  limits: AgentRuntimeLimits;
  requestId?: string;
  trace: (event: AgentTraceEventInput) => void;
};

export type AgentTool<Args = unknown, Result = unknown> = {
  name: string;
  description: string;
  schema: z.ZodType<Args>;
  execute: (args: Args, context: AgentToolContext) => Promise<Result> | Result;
};

export type AgentTraceEventInput = Omit<AgentTraceEvent, "at" | "sequence">;

export type AgentTraceEvent = {
  sequence: number;
  at: string;
  type:
    | "run_started"
    | "run_completed"
    | "loop_started"
    | "loop_completed"
    | "loop_limit_reached"
    | "tool_requested"
    | "tool_started"
    | "tool_succeeded"
    | "tool_failed"
    | "tool_cache_hit"
    | "tool_duplicate_blocked";
  message?: string;
  callId?: string;
  toolName?: string;
  fingerprint?: string;
  data?: Record<string, unknown>;
};

export type AgentRuntimeSnapshot = {
  startedAt: string;
  elapsedMs: number;
  loopCount: number;
  toolCallCount: number;
  cacheKeys: string[];
  trace: AgentTraceEvent[];
};
