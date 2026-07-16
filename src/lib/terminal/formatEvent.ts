import type {
  DiscoveryJob,
  DiscoveryJobEvent,
  DiscoveryJobSummary,
  TerminalEventLevel,
  TerminalLine,
} from "@/lib/terminal/types";

const NOISY_WARNING =
  /fingerprint|page-fingerprint|page fingerprint|rawHtml|selector dump|dom snapshot/i;

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

export function shouldSuppressTerminalEvent(
  event: DiscoveryJobEvent,
  verbose = false,
): boolean {
  if (verbose) return false;
  if (NOISY_WARNING.test(event.message)) return true;
  const warnings = event.metadata?.warnings;
  if (typeof warnings === "string" && NOISY_WARNING.test(warnings)) return true;
  return false;
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

function formatDeadlineDisplay(value: unknown, deadlineState?: unknown): string {
  if (deadlineState === "missing" || value == null || value === "" || value === "Unknown") {
    return "Not publicly listed";
  }
  if (typeof value !== "string") return "Not publicly listed";
  return value;
}

function formatEventPeriod(candidate: Record<string, unknown>): string {
  const start = typeof candidate.eventStartDate === "string" ? candidate.eventStartDate : undefined;
  const end = typeof candidate.eventEndDate === "string" ? candidate.eventEndDate : undefined;
  const displayed =
    typeof candidate.displayedDateRange === "string" ? candidate.displayedDateRange : undefined;
  if (displayed) return displayed;
  if (start && end && end !== start) return `${start} to ${end}`;
  if (start) return start;
  return "Not publicly listed";
}

export function formatTerminalCandidateResult(
  candidate: Record<string, unknown>,
): string {
  const name = typeof candidate.name === "string" ? candidate.name : "Untitled";
  const judgingStart =
    typeof candidate.judgingStartDate === "string" ? candidate.judgingStartDate : undefined;
  const judgingEnd =
    typeof candidate.judgingEndDate === "string" ? candidate.judgingEndDate : undefined;
  const judging =
    judgingStart && judgingEnd
      ? `${judgingStart} to ${judgingEnd}`
      : judgingStart || judgingEnd || "Not publicly listed";
  const themes = Array.isArray(candidate.themes)
    ? candidate.themes.filter((item): item is string => typeof item === "string").join(", ")
    : typeof candidate.themes === "string"
      ? candidate.themes
      : "Unknown";
  const evidence =
    typeof candidate.evidenceSummary === "string"
      ? candidate.evidenceSummary
      : "Listing evidence";

  return [
    name,
    "",
    `- Event/competition period: ${formatEventPeriod(candidate)}`,
    `- Applications close: ${formatDeadlineDisplay(candidate.applicationDeadline, candidate.deadlineState)}`,
    `- Submissions close: ${formatDeadlineDisplay(candidate.submissionDeadline)}`,
    `- Judging period: ${judging}`,
    `- Location: ${typeof candidate.location === "string" ? candidate.location : "Unknown"}`,
    `- Mode: ${typeof candidate.participationMode === "string" ? candidate.participationMode : "unknown"}`,
    `- Eligibility: ${typeof candidate.eligibility === "string" ? candidate.eligibility : "See official rules"}`,
    `- Themes: ${themes}`,
    `- Status: ${typeof candidate.status === "string" ? candidate.status : "Unknown"}`,
    `- Source: ${typeof candidate.source === "string" ? candidate.source : "unknown"}`,
    `- Evidence: ${evidence}`,
  ].join("\n");
}

export function formatJobSummary(job: DiscoveryJob): string {
  const s = job.summary ?? {};
  const lines: string[] = ["[complete] Run summary"];

  const created = job.createdCount ?? num(s.created);
  const updated = job.updatedCount ?? num(s.updated);
  const accepted = job.acceptedCount ?? num(s.accepted);
  const rejected = job.rejectedCount ?? num(s.rejected);
  const needsReview = job.needsReviewCount ?? num(s.needsReview);
  const queueReady =
    num(s.queueReady) ??
    (typeof accepted === "number" && typeof needsReview === "number"
      ? Math.max(0, accepted - needsReview)
      : undefined);
  const rawLeads = num(s.rawLeads) ?? num((job as { rawLeadsCount?: number }).rawLeadsCount);
  const uniqueLeads = num(s.uniqueLeads);
  const durationMs =
    num(s.durationMs) ?? num((job as { durationMs?: number | null }).durationMs);
  const llmCalls = num(s.llmCalls);
  const fallbackUsed =
    typeof s.fallbackUsed === "boolean" ? s.fallbackUsed : undefined;
  const profile = typeof s.profile === "string" ? s.profile : undefined;
  const dryRun = typeof s.dryRun === "boolean" ? s.dryRun : undefined;

  if (profile) lines.push(`  profile  ${profile}`);
  if (dryRun != null) lines.push(`  dry-run  ${dryRun ? "yes" : "no"}`);
  pushCount(lines, "raw collected", rawLeads);
  pushCount(lines, "unique candidates", uniqueLeads);
  pushCount(lines, "queue-ready", queueReady);
  pushCount(lines, "needs review", needsReview);
  pushCount(lines, "rejected", rejected);
  // Dry-run persistence metrics are projected creates/updates, not applied writes.
  pushCount(lines, dryRun ? "would create" : "created", created);
  pushCount(lines, dryRun ? "would update" : "updated", updated);

  const sourceStats = Array.isArray(s.sourceStats) ? s.sourceStats : [];
  for (const stats of sourceStats) {
    if (!stats || typeof stats !== "object") continue;
    const row = stats as Record<string, unknown>;
    const source = typeof row.source === "string" ? row.source : "source";
    const telemetry =
      row.telemetry && typeof row.telemetry === "object"
        ? (row.telemetry as Record<string, unknown>)
        : undefined;
    const collectedRaw = num(row.collectedRaw) ?? num(telemetry?.collectedRaw) ?? num(row.leadsFound) ?? 0;
    const collectedUnique =
      num(row.collectedUnique) ?? num(telemetry?.collectedUnique) ?? collectedRaw;
    const classified =
      num(row.classifiedHackathon) ?? num(telemetry?.classifiedHackathon) ?? 0;
    const feedTheme =
      num(row.feedThemeCandidate) ?? num(telemetry?.feedThemeCandidate) ?? 0;
    const contentTheme =
      num(row.contentThemeMatched) ??
      num(telemetry?.contentThemeMatched) ??
      num(row.themeRelevant) ??
      num(telemetry?.themeRelevant) ??
      0;
    const themeRelevant = contentTheme;
    const queryRelevant =
      num(row.queryRelevant) ?? num(telemetry?.queryRelevant) ?? num(row.accepted) ?? 0;
    const ready = num(row.queueReady) ?? num(telemetry?.queueReady) ?? 0;
    const review = num(row.needsReview) ?? num(telemetry?.needsReview) ?? 0;
    const rejectedCount =
      num(row.rejected) ??
      num(telemetry?.rejected) ??
      num(row.invalidRejected) ??
      0;
    const elapsed = num(row.durationMs) ?? num(telemetry?.totalDurationMs);
    const scope =
      typeof row.acquisitionScope === "string"
        ? row.acquisitionScope
        : typeof telemetry?.acquisitionScope === "string"
          ? telemetry.acquisitionScope
          : "unknown";
    const inventory = formatInventoryEstimate(
      row.observedDirectoryInventory ??
        telemetry?.observedDirectoryInventory ??
        row.observedInventory ??
        telemetry?.observedInventory,
    );
    const directoryReported =
      num(row.directoryReportedTotal) ??
      num(telemetry?.directoryReportedTotal) ??
      undefined;
    const targetForProfile =
      num(row.targetForProfile) ?? num(telemetry?.targetForProfile) ?? undefined;
    const targetReached =
      typeof row.targetReached === "boolean"
        ? row.targetReached
        : typeof telemetry?.targetReached === "boolean"
          ? telemetry.targetReached
          : undefined;
    const stopReason =
      typeof row.stopReason === "string"
        ? row.stopReason
        : typeof telemetry?.stopReason === "string"
          ? telemetry.stopReason
          : Array.isArray(row.warnings) && typeof row.warnings[0] === "string"
            ? String(row.warnings[0])
            : typeof row.outcome === "string"
              ? row.outcome
              : undefined;
    const stopEvidence =
      typeof row.stopEvidence === "string"
        ? row.stopEvidence
        : typeof telemetry?.stopEvidence === "string"
          ? telemetry.stopEvidence
          : undefined;
    const targetLabel =
      typeof targetForProfile === "number"
        ? `, target ${targetForProfile}${typeof targetReached === "boolean" ? (targetReached ? "✓" : "✗") : ""}`
        : "";
    const reportedLabel =
      typeof directoryReported === "number" ? `, directory-reported ${directoryReported}` : "";
    lines.push(
      `  [${source}] scope ${scope}, directory-inventory ${inventory}${reportedLabel}, raw ${collectedRaw}, unique ${collectedUnique}${targetLabel}, classified-hackathon ${classified}, feed-theme ${feedTheme}, content-theme ${contentTheme}, theme-relevant ${themeRelevant}, query-relevant ${queryRelevant}, queue-ready ${ready}, needs review ${review}, rejected ${rejectedCount}${
        typeof elapsed === "number" ? `, ${formatDuration(elapsed)}` : ""
      }${stopReason ? `, stop: ${stopReason}` : ""}${stopEvidence ? ` (${stopEvidence})` : ""}`,
    );
  }

  const sourceCounts = s.sourceCounts;
  if (sourceCounts && typeof sourceCounts === "object" && sourceStats.length === 0) {
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

  const candidates = Array.isArray(s.acceptedCandidates)
    ? (s.acceptedCandidates as Array<Record<string, unknown>>)
    : [];
  if (candidates.length > 0) {
    lines.push("");
    lines.push("[result] Candidates");
    for (const candidate of candidates.slice(0, 20)) {
      lines.push(formatTerminalCandidateResult(candidate));
      lines.push("");
    }
    if (candidates.length > 20) {
      lines.push(`… ${candidates.length - 20} more candidates`);
    }
  }

  const warnings = Array.isArray(s.warnings)
    ? s.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];
  const verbose = s.verbose === true;
  const visibleWarnings = verbose
    ? warnings
    : warnings.filter((warning) => !NOISY_WARNING.test(warning));
  if (visibleWarnings.length > 0) {
    lines.push("[warnings]");
    for (const warning of visibleWarnings.slice(0, verbose ? 100 : 12)) {
      lines.push(`  - ${warning}`);
    }
    if (!verbose && warnings.length > visibleWarnings.length) {
      lines.push("  - (noisy fingerprint/page dumps hidden; use --verbose)");
    }
  }

  if (job.safeErrorMessage) {
    lines.push(`  note  ${job.safeErrorMessage}`);
  }

  return lines.join("\n").trimEnd();
}

function formatInventoryEstimate(value: unknown): string {
  if (!value || typeof value !== "object") return "n/a";
  const row = value as Record<string, unknown>;
  const count = num(row.value);
  const method = typeof row.method === "string" ? row.method : undefined;
  const confidence = typeof row.confidence === "string" ? row.confidence : undefined;
  if (typeof count !== "number" || !method || !confidence) return "n/a";
  return `${count} (${method}/${confidence})`;
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
