import { randomUUID } from "node:crypto";

export const DISCOVERY_EVENT_TYPES = [
  "run_queued",
  "run_started",
  "planning_started",
  "planning_completed",
  "source_started",
  "source_progress",
  "source_completed",
  "source_degraded",
  "source_auth_required",
  "enrichment_started",
  "verification_started",
  "dedupe_completed",
  "persistence_started",
  "run_completed",
  "run_failed",
  "run_cancelled",
] as const;

export type DiscoveryEventType = (typeof DISCOVERY_EVENT_TYPES)[number];

export type DiscoveryEventLevel = "info" | "success" | "warning" | "error";

export type DiscoveryEvent = {
  id: string;
  runId: string;
  sequence: number;
  timestamp: string;
  type: DiscoveryEventType;
  level: DiscoveryEventLevel;
  source?: string;
  message: string;
  metadata?: Record<string, unknown>;
};

export type DiscoveryEventSink = {
  emit: (event: Omit<DiscoveryEvent, "id" | "sequence" | "timestamp"> & {
    id?: string;
    sequence?: number;
    timestamp?: string;
  }) => void | Promise<void>;
};

const SECRET_KEY_PATTERN =
  /(api[_-]?key|token|secret|password|cookie|authorization|bearer|service[_-]?account|profile[_-]?path|rawHtml|prompt|chainOfThought|cot)/i;

/** Strip keys that must never appear in discovery events. */
export function sanitizeEventMetadata(
  metadata?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    if (typeof value === "string" && value.length > 500) {
      clean[key] = `${value.slice(0, 200)}…`;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      clean[key] = sanitizeEventMetadata(value as Record<string, unknown>);
      continue;
    }
    clean[key] = value;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export function createEventEmitter(
  runId: string,
  sink?: DiscoveryEventSink,
): {
  emit: (
    type: DiscoveryEventType,
    message: string,
    options?: {
      level?: DiscoveryEventLevel;
      source?: string;
      metadata?: Record<string, unknown>;
    },
  ) => Promise<DiscoveryEvent>;
  sequence: () => number;
} {
  let sequence = 0;

  return {
    sequence: () => sequence,
    async emit(type, message, options = {}) {
      sequence += 1;
      const event: DiscoveryEvent = {
        id: randomUUID(),
        runId,
        sequence,
        timestamp: new Date().toISOString(),
        type,
        level: options.level ?? defaultLevel(type),
        source: options.source,
        message,
        metadata: sanitizeEventMetadata(options.metadata),
      };
      await sink?.emit(event);
      return event;
    },
  };
}

function defaultLevel(type: DiscoveryEventType): DiscoveryEventLevel {
  switch (type) {
    case "run_completed":
    case "source_completed":
    case "planning_completed":
    case "dedupe_completed":
      return "success";
    case "source_degraded":
    case "source_auth_required":
      return "warning";
    case "run_failed":
      return "error";
    case "run_cancelled":
      return "warning";
    default:
      return "info";
  }
}

export function createStdoutEventSink(
  write: (line: string) => void = (line) => console.log(line),
): DiscoveryEventSink {
  return {
    emit(event) {
      write(formatDiscoveryEventForCli(event as DiscoveryEvent));
    },
  };
}

/** Human-readable CLI lines compatible with existing terminal-style output. */
export function formatDiscoveryEventForCli(event: DiscoveryEvent): string {
  const prefix = event.source ? `[${event.source}]` : bracketForType(event.type);
  return `${prefix} ${event.message}`;
}

function bracketForType(type: DiscoveryEventType): string {
  switch (type) {
    case "planning_started":
    case "planning_completed":
      return "[planning]";
    case "enrichment_started":
      return "[enrich]";
    case "verification_started":
      return "[verify]";
    case "dedupe_completed":
      return "[dedupe]";
    case "persistence_started":
      return "[storage]";
    case "run_started":
    case "run_queued":
      return "[run]";
    case "run_completed":
      return "[complete]";
    case "run_failed":
      return "[failed]";
    case "run_cancelled":
      return "[cancelled]";
    default:
      return "[discovery]";
  }
}
