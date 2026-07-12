import type {
  DiscoveryJob,
  DiscoveryJobEvent,
  DiscoveryJobSummary,
  TerminalEventLevel,
  TerminalLine,
} from "@/lib/terminal/types";

function levelToKind(
  level: TerminalEventLevel,
): TerminalLine["kind"] {
  switch (level) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "error":
      return "error";
    default:
      return "event";
  }
}

/** Format a live job event for the console. */
export function formatJobEventLine(event: DiscoveryJobEvent): string {
  const tag = event.source
    ? `[${event.source}]`
    : event.type
      ? `[${shortType(event.type)}]`
      : "[run]";
  return `${tag} ${event.message}`;
}

function shortType(type: string): string {
  return type
    .replace(/^run_/, "")
    .replace(/_started$/, "")
    .replace(/_completed$/, "")
    .replace(/_/g, " ");
}

export function jobEventToTerminalLine(
  event: DiscoveryJobEvent,
  lineId: string,
): TerminalLine {
  return {
    id: lineId,
    kind: levelToKind(event.level),
    text: formatJobEventLine(event),
    level: event.level,
    source: event.source,
    timestamp: event.timestamp,
    eventSequence: event.sequence,
    jobId: event.jobId,
  };
}

export function formatJobSummary(job: DiscoveryJob): string {
  const s = job.summary ?? {};
  const lines: string[] = ["[complete] Run summary"];

  const created = job.createdCount ?? num(s.created);
  const updated = job.updatedCount ?? num(s.updated);
  const accepted = job.acceptedCount ?? num(s.accepted);
  const rejected = job.rejectedCount ?? num(s.rejected);
  const needsReview = job.needsReviewCount ?? num(s.needsReview);
  const rawLeads = num(s.rawLeads) ?? num((job as { rawLeadsCount?: number }).rawLeadsCount);
  const uniqueLeads = num(s.uniqueLeads);
  const durationMs =
    num(s.durationMs) ?? num((job as { durationMs?: number | null }).durationMs);
  const llmCalls = num(s.llmCalls);
  const fallbackUsed =
    typeof s.fallbackUsed === "boolean" ? s.fallbackUsed : undefined;

  pushCount(lines, "raw leads", rawLeads);
  pushCount(lines, "unique / deduped", uniqueLeads);
  pushCount(lines, "accepted", accepted);
  pushCount(lines, "rejected", rejected);
  pushCount(lines, "needs review", needsReview);
  pushCount(lines, "created", created);
  pushCount(lines, "updated", updated);

  const sourceCounts = s.sourceCounts;
  if (sourceCounts && typeof sourceCounts === "object") {
    const parts = Object.entries(sourceCounts as Record<string, number>)
      .map(([name, n]) => `${name}:${n}`)
      .join(" · ");
    if (parts) lines.push(`  sources  ${parts}`);
  }

  if (typeof durationMs === "number") {
    lines.push(`  duration  ${formatDuration(durationMs)}`);
  }
  if (typeof llmCalls === "number") {
    lines.push(`  llm calls  ${llmCalls}`);
  }
  if (typeof fallbackUsed === "boolean") {
    lines.push(`  fallback  ${fallbackUsed ? "yes" : "no"}`);
  }

  if (job.safeErrorMessage) {
    lines.push(`  note  ${job.safeErrorMessage}`);
  }

  return lines.join("\n");
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function pushCount(
  lines: string[],
  label: string,
  value: number | null | undefined,
): void {
  if (typeof value === "number") {
    lines.push(`  ${label}  ${value}`);
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}

export function formatStatusLine(job: DiscoveryJob): string {
  const stage = job.currentStage ? ` · ${job.currentStage}` : "";
  const sources =
    job.effectiveSources && job.effectiveSources.length > 0
      ? ` · sources: ${job.effectiveSources.join(", ")}`
      : "";
  return `[status] ${job.status}${stage}${sources} · id ${shortId(job.id)}`;
}

export function formatHistoryLine(job: DiscoveryJob): string {
  const when = job.completedAt ?? job.startedAt ?? job.createdAt;
  return `[history] ${job.status} · ${shortId(job.id)} · ${when} · ${truncate(job.command, 72)}`;
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export function normalizeJobEvent(
  raw: Record<string, unknown>,
  fallbackJobId: string,
): DiscoveryJobEvent | null {
  const id = stringOrNull(raw.id) ?? stringOrNull(raw.eventId);
  const sequence = numberOrNull(raw.sequence);
  const message = stringOrNull(raw.message);
  if (!id || sequence == null || !message) return null;

  const jobId =
    stringOrNull(raw.jobId) ??
    stringOrNull(raw.runId) ??
    fallbackJobId;

  const level = normalizeLevel(raw.level);

  return {
    id,
    jobId,
    sequence,
    timestamp: stringOrNull(raw.timestamp) ?? new Date().toISOString(),
    type: stringOrNull(raw.type) ?? stringOrNull(raw.event_type) ?? "event",
    level,
    source: stringOrNull(raw.source),
    message,
    metadata:
      raw.metadata && typeof raw.metadata === "object"
        ? (raw.metadata as Record<string, unknown>)
        : null,
  };
}

function normalizeLevel(value: unknown): TerminalEventLevel {
  if (value === "success" || value === "warning" || value === "error" || value === "info") {
    return value;
  }
  return "info";
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function summaryFromJobFields(job: DiscoveryJob): DiscoveryJobSummary {
  return {
    ...(job.summary ?? {}),
    created: job.createdCount ?? job.summary?.created,
    updated: job.updatedCount ?? job.summary?.updated,
    accepted: job.acceptedCount ?? job.summary?.accepted,
    rejected: job.rejectedCount ?? job.summary?.rejected,
    needsReview: job.needsReviewCount ?? job.summary?.needsReview,
  };
}
