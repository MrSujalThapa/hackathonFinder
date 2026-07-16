/**
 * Typed client for discovery job APIs.
 *
 * Contract (job-runtime + sources agents):
 *
 * POST   /api/discovery/jobs
 *   body: { command, sources?, dryRun?, maxAgentCalls?, mode?, allSources? }
 *   → { data: { job, execution }, error: null }  (201)
 *
 * GET    /api/discovery/jobs
 *   → { data: { jobs, executionMode }, error: null }
 *
 * GET    /api/discovery/jobs/:id
 *   → { data: { job }, error: null }
 *
 * GET    /api/discovery/jobs/:id/events?after=<sequence>
 *   → text/event-stream
 *   SSE: named events = DiscoveryEvent.type; final `event: end`
 *   Event JSON uses runId (job id), sequence, level, source?, message, metadata?
 *
 * POST   /api/discovery/jobs/:id/cancel
 *   → { data: { job }, error: null }
 *
 * GET    /api/sources
 *   → { data: { sources: SourceHealth[] }, error: null }
 *
 * UI must not invent progress — only render streamed events.
 */

import type { ApiEnvelope } from "@/server/api/envelope";
import type {
  CancelDiscoveryJobResult,
  CreateDiscoveryJobInput,
  CreateDiscoveryJobResult,
  DiscoveryJob,
  DiscoveryJobEvent,
  GetDiscoveryJobResult,
  ListDiscoveryJobsResult,
  ListSourceHealthResult,
  SourceHealth,
  SourceCommandAction,
  TerminalEventLevel,
  TerminalSourceName,
} from "@/lib/terminal/types";
import type {
  TerminalCommandHistoryEntry,
  TerminalSession,
} from "@/lib/terminal/sessions";
import { normalizeJobEvent } from "@/lib/terminal/formatEvent";

const SSE_EVENT_NAMES = [
  "message",
  "ready",
  "end",
  "error",
  "run_queued",
  "run_started",
  "query_interpreted",
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
  "result_summary_updated",
  "persistence_started",
  "persistence_completed",
  "run_completed",
  "run_failed",
  "run_cancelled",
] as const;

export class DiscoveryApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "DiscoveryApiError";
    this.code = code;
    this.status = status;
  }
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  let body: ApiEnvelope<T>;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new DiscoveryApiError(
      `Request failed (${response.status})`,
      "INTERNAL_ERROR",
      response.status,
    );
  }
  if (!response.ok || body.error || body.data == null) {
    throw new DiscoveryApiError(
      body.error?.message ?? `Request failed (${response.status})`,
      body.error?.code ?? "INTERNAL_ERROR",
      response.status,
    );
  }
  return body.data;
}

export async function createDiscoveryJob(
  input: CreateDiscoveryJobInput,
): Promise<DiscoveryJob> {
  const response = await fetch("/api/discovery/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  const data = await parseEnvelope<CreateDiscoveryJobResult & { execution?: unknown }>(
    response,
  );
  return data.job;
}

export async function listDiscoveryJobs(): Promise<DiscoveryJob[]> {
  const response = await fetch("/api/discovery/jobs", { cache: "no-store" });
  const data = await parseEnvelope<ListDiscoveryJobsResult>(response);
  return data.jobs ?? [];
}

export async function getDiscoveryJob(id: string): Promise<DiscoveryJob> {
  const response = await fetch(`/api/discovery/jobs/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  const data = await parseEnvelope<GetDiscoveryJobResult>(response);
  return data.job;
}

export async function cancelDiscoveryJob(id: string): Promise<DiscoveryJob> {
  const response = await fetch(
    `/api/discovery/jobs/${encodeURIComponent(id)}/cancel`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    },
  );
  const data = await parseEnvelope<CancelDiscoveryJobResult>(response);
  return data.job;
}

export async function fetchSourceHealth(): Promise<SourceHealth[]> {
  const response = await fetch("/api/sources", { cache: "no-store" });
  const data = await parseEnvelope<ListSourceHealthResult>(response);
  return data.sources ?? [];
}

export type TerminalSourceCommandLine = {
  level: TerminalEventLevel;
  text: string;
};

export type TerminalSourceCommandResult = {
  lines: TerminalSourceCommandLine[];
  confirmationRequired?: boolean;
  expiresAt?: string;
};

export async function runTerminalSourceCommand(input: {
  action: SourceCommandAction | "confirm_disconnect";
  source: TerminalSourceName;
  sessionId: string;
}): Promise<TerminalSourceCommandResult> {
  const response = await fetch("/api/terminal/source", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  return parseEnvelope<TerminalSourceCommandResult>(response);
}

export type TerminalSiteCommandLine = {
  level: TerminalEventLevel;
  text: string;
};

export type TerminalSiteCommandResult = {
  lines: TerminalSiteCommandLine[];
  site?: unknown;
  sites?: unknown[];
};

export async function runTerminalSiteCommand(input: {
  action:
    | "save"
    | "list"
    | "status"
    | "check"
    | "enable"
    | "disable"
    | "remove_confirm"
    | "configure";
  name?: string;
  url?: string;
  mode?: "auto" | "static" | "playwright";
  location?: string;
  topics?: string[];
  maxItems?: number;
  enabled?: boolean;
  selectors?: {
    cardSelector?: string;
    titleSelector?: string;
    linkSelector?: string;
    strategy?: "auto" | "cards" | "table" | "list";
    titleColumn?: string;
    dateColumn?: string;
    typeColumn?: string;
    urlColumn?: string;
  };
}): Promise<TerminalSiteCommandResult> {
  const response = await fetch("/api/terminal/site", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  return parseEnvelope<TerminalSiteCommandResult>(response);
}

export type ListTerminalSessionsApiResult = {
  sessions: TerminalSession[];
  selectedSession: TerminalSession | null;
};

export type TerminalSessionApiResult = {
  session: TerminalSession;
};

export type TerminalSessionHistoryApiResult = {
  session: TerminalSession;
  commandHistory: TerminalCommandHistoryEntry[];
  jobs: DiscoveryJob[];
  events: Record<string, DiscoveryJobEvent[]>;
};

export type AppendTerminalCommandHistoryResult = {
  entry: TerminalCommandHistoryEntry;
};

export async function listTerminalSessions(): Promise<ListTerminalSessionsApiResult> {
  const response = await fetch("/api/terminal/sessions", { cache: "no-store" });
  return parseEnvelope<ListTerminalSessionsApiResult>(response);
}

export async function createTerminalSession(input: {
  id?: string;
  title?: string;
  select?: boolean;
}): Promise<TerminalSession> {
  const response = await fetch("/api/terminal/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  const data = await parseEnvelope<TerminalSessionApiResult>(response);
  return data.session;
}

export async function updateTerminalSession(
  id: string,
  input:
    | { action: "select" | "touch" | "close" | "reopen" }
    | { action: "rename"; title: string },
): Promise<TerminalSession> {
  const response = await fetch(`/api/terminal/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  const data = await parseEnvelope<TerminalSessionApiResult>(response);
  return data.session;
}

export async function fetchTerminalSessionHistory(
  id: string,
): Promise<TerminalSessionHistoryApiResult> {
  const response = await fetch(
    `/api/terminal/sessions/${encodeURIComponent(id)}/history`,
    { cache: "no-store" },
  );
  return parseEnvelope<TerminalSessionHistoryApiResult>(response);
}

export async function appendTerminalCommandHistory(
  id: string,
  command: string,
): Promise<TerminalCommandHistoryEntry> {
  const response = await fetch(
    `/api/terminal/sessions/${encodeURIComponent(id)}/history`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
      cache: "no-store",
    },
  );
  const data = await parseEnvelope<AppendTerminalCommandHistoryResult>(response);
  return data.entry;
}

export type StreamJobEventsHandlers = {
  onEvent: (event: DiscoveryJobEvent) => void;
  onError?: (error: Error) => void;
  onDone?: () => void;
};

/**
 * Subscribe to job events via SSE.
 * Returns an abort/close function.
 */
export function streamJobEvents(
  jobId: string,
  afterSequence: number,
  handlers: StreamJobEventsHandlers,
): () => void {
  const url = `/api/discovery/jobs/${encodeURIComponent(jobId)}/events?after=${encodeURIComponent(String(afterSequence))}`;
  const source = new EventSource(url);
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    source.close();
  };

  const handlePayload = (rawData: string, sseEventName?: string) => {
    if (closed) return;
    if (sseEventName === "ready") return;
    if (sseEventName === "end" || rawData === "[DONE]" || rawData === "done") {
      handlers.onDone?.();
      cleanup();
      return;
    }
    if (sseEventName === "error") {
      try {
        const parsed = JSON.parse(rawData) as { message?: string };
        handlers.onError?.(new Error(parsed.message ?? "Event stream error"));
      } catch {
        handlers.onError?.(new Error("Event stream error"));
      }
      return;
    }
    try {
      const parsed = JSON.parse(rawData) as Record<string, unknown>;
      const event = normalizeJobEvent(parsed, jobId);
      if (!event) return;
      handlers.onEvent(event);
      if (
        event.type === "run_completed" ||
        event.type === "run_failed" ||
        event.type === "run_cancelled"
      ) {
        // Prefer waiting for `end`, but complete if the stream stalls.
      }
    } catch (error) {
      handlers.onError?.(
        error instanceof Error ? error : new Error("Invalid event payload"),
      );
    }
  };

  for (const name of SSE_EVENT_NAMES) {
    source.addEventListener(name, ((ev: Event) => {
      const message = ev as MessageEvent<string>;
      handlePayload(message.data ?? "", name);
    }) as EventListener);
  }

  source.onmessage = (ev) => handlePayload(ev.data, "message");

  source.onerror = () => {
    if (closed) return;
    // Browser may auto-retry; surface a soft signal without closing.
    handlers.onError?.(
      new Error("Event stream interrupted — reconnecting if the run is still active."),
    );
  };

  return cleanup;
}
