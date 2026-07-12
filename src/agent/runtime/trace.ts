import type { AgentTraceEvent, AgentTraceEventInput } from "./types";

export type AgentTraceRecorder = {
  add: (event: AgentTraceEventInput) => AgentTraceEvent;
  events: () => AgentTraceEvent[];
};

export function createTraceRecorder(now: () => Date = () => new Date()): AgentTraceRecorder {
  const events: AgentTraceEvent[] = [];

  return {
    add(event) {
      const next: AgentTraceEvent = {
        ...event,
        sequence: events.length + 1,
        at: now().toISOString(),
      };
      events.push(next);
      return next;
    },
    events() {
      return [...events];
    },
  };
}
