import { ZodError } from "zod";
import { hasRuntimeTimeRemaining, remainingRuntimeMs } from "./limits";
import type { AgentRuntimeState } from "./state";
import { addTrace } from "./state";
import type { AgentToolRegistry } from "./toolRegistry";
import type {
  AgentToolCall,
  AgentToolError,
  AgentToolFailureResult,
  AgentToolResult,
} from "./types";

function normalizeForKey(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForKey);
  }

  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) {
        sorted[key] = normalizeForKey(child);
      }
    }
    return sorted;
  }

  return value;
}

export function stableToolCallKey(call: AgentToolCall): string {
  return `${call.name}:${JSON.stringify(normalizeForKey(call.args))}`;
}

function failure(
  call: AgentToolCall,
  error: AgentToolError,
  startedAt: number,
  options: { cached?: boolean; duplicate?: boolean } = {},
): AgentToolFailureResult {
  return {
    ok: false,
    call,
    error,
    cached: options.cached ?? false,
    duplicate: options.duplicate ?? false,
    durationMs: Date.now() - startedAt,
  };
}

function timeoutAfter<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Tool timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export async function executeTool(options: {
  state: AgentRuntimeState;
  registry: AgentToolRegistry;
  call: AgentToolCall;
}): Promise<AgentToolResult> {
  const { state, registry, call } = options;
  const startedAt = Date.now();
  const fingerprint = stableToolCallKey(call);

  addTrace(state, {
    type: "tool_requested",
    callId: call.id,
    toolName: call.name,
    fingerprint,
  });

  if (!hasRuntimeTimeRemaining(state.startedAtMs, state.limits)) {
    const result = failure(
      call,
      {
        code: "TIME_LIMIT",
        message: `Runtime exceeded ${state.limits.maxElapsedMs}ms.`,
      },
      startedAt,
    );
    addTrace(state, {
      type: "tool_failed",
      callId: call.id,
      toolName: call.name,
      fingerprint,
      message: result.error.message,
      data: { code: result.error.code },
    });
    return result;
  }

  const tool = registry.get(call.name);
  if (!tool) {
    const result = failure(
      call,
      {
        code: "UNKNOWN_TOOL",
        message: `Tool is not registered: ${call.name}`,
      },
      startedAt,
    );
    addTrace(state, {
      type: "tool_failed",
      callId: call.id,
      toolName: call.name,
      fingerprint,
      message: result.error.message,
      data: { code: result.error.code },
    });
    return result;
  }

  const cached = state.cache.get(fingerprint);
  if (cached !== undefined) {
    addTrace(state, {
      type: "tool_cache_hit",
      callId: call.id,
      toolName: call.name,
      fingerprint,
      message: "Returned cached tool result.",
    });
    return {
      ok: true,
      call,
      result: cached,
      cached: true,
      duplicate: true,
      durationMs: Date.now() - startedAt,
    };
  }

  if (state.seenToolCalls.has(fingerprint)) {
    const result = failure(
      call,
      {
        code: "DUPLICATE_TOOL_CALL",
        message: "Duplicate tool call was blocked.",
      },
      startedAt,
      { duplicate: true },
    );
    addTrace(state, {
      type: "tool_duplicate_blocked",
      callId: call.id,
      toolName: call.name,
      fingerprint,
      message: result.error.message,
      data: { code: result.error.code },
    });
    return result;
  }

  if (state.toolCallCount >= state.limits.maxToolCalls) {
    const result = failure(
      call,
      {
        code: "TOOL_CALL_LIMIT",
        message: `Tool call limit ${state.limits.maxToolCalls} reached.`,
      },
      startedAt,
    );
    addTrace(state, {
      type: "tool_failed",
      callId: call.id,
      toolName: call.name,
      fingerprint,
      message: result.error.message,
      data: { code: result.error.code },
    });
    return result;
  }

  let parsedArgs: unknown;
  try {
    parsedArgs = tool.schema.parse(call.args);
  } catch (error) {
    const message =
      error instanceof ZodError
        ? error.issues.map((issue) => issue.message).join("; ")
        : "Invalid tool arguments.";
    const result = failure(
      call,
      {
        code: "INVALID_ARGS",
        message,
      },
      startedAt,
    );
    addTrace(state, {
      type: "tool_failed",
      callId: call.id,
      toolName: call.name,
      fingerprint,
      message: result.error.message,
      data: { code: result.error.code },
    });
    return result;
  }

  state.seenToolCalls.add(fingerprint);
  state.toolCallCount += 1;

  addTrace(state, {
    type: "tool_started",
    callId: call.id,
    toolName: call.name,
    fingerprint,
  });

  try {
    const timeoutMs = Math.min(
      state.limits.perToolTimeoutMs,
      remainingRuntimeMs(state.startedAtMs, state.limits),
    );
    const result = await timeoutAfter(
      Promise.resolve(
        tool.execute(parsedArgs, {
          limits: state.limits,
          requestId: state.requestId,
          trace: (event) => addTrace(state, event),
        }),
      ),
      timeoutMs,
    );
    state.cache.set(fingerprint, result);
    addTrace(state, {
      type: "tool_succeeded",
      callId: call.id,
      toolName: call.name,
      fingerprint,
      data: { durationMs: Date.now() - startedAt },
    });
    return {
      ok: true,
      call,
      result,
      cached: false,
      duplicate: false,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed.";
    const code = /timed out/i.test(message) ? "TOOL_TIMEOUT" : "TOOL_ERROR";
    const result = failure(call, { code, message }, startedAt);
    addTrace(state, {
      type: "tool_failed",
      callId: call.id,
      toolName: call.name,
      fingerprint,
      message: result.error.message,
      data: { code: result.error.code },
    });
    return result;
  }
}
