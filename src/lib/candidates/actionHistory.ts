import type { CandidateAction } from "@/core/candidates/types";

export const USER_VISIBLE_ACTIONS = new Set([
  "APPROVE",
  "REJECT",
  "SAVE_FOR_LATER",
  "SAVE",
  "RESTORE",
  "SHEET_APPEND",
  "SHEET_DELETE",
  "ASK",
  "ENRICH",
  "UNDO",
]);

export const TECHNICAL_ACTIONS = new Set([
  "UPDATE_FROM_DUPLICATE",
]);

export type ActionHistoryBucket =
  | { kind: "action"; action: CandidateAction }
  | {
      kind: "technical_summary";
      count: number;
      lastAt: string;
      actions: CandidateAction[];
    };

export function isTechnicalAction(action: CandidateAction): boolean {
  if (TECHNICAL_ACTIONS.has(action.action)) return true;
  // No-op status transitions (e.g. NEW -> NEW)
  if (
    action.previousStatus &&
    action.newStatus &&
    action.previousStatus === action.newStatus
  ) {
    return true;
  }
  // Reconciliation / metadata-only noise
  const meta = action.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const record = meta as Record<string, unknown>;
    if (record.reconcile === true || record.automatic === true) return true;
  }
  return false;
}

export function isUserVisibleAction(action: CandidateAction): boolean {
  if (isTechnicalAction(action)) return false;
  if (USER_VISIBLE_ACTIONS.has(action.action)) return true;
  // Research / ask-related custom actions
  if (/ask|research|question/i.test(action.action)) return true;
  return false;
}

/**
 * Build a default-visible timeline: meaningful actions first (newest),
 * capped; technical refreshes collapsed into one summary.
 */
export function buildActionHistory(
  actions: CandidateAction[],
  options: { meaningfulLimit?: number } = {},
): {
  visible: ActionHistoryBucket[];
  technical: CandidateAction[];
  truncatedMeaningful: number;
} {
  const limit = options.meaningfulLimit ?? 20;
  const sorted = [...actions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const meaningful = sorted.filter(isUserVisibleAction);
  const technical = sorted.filter(isTechnicalAction);
  const truncated = Math.max(0, meaningful.length - limit);

  const visible: ActionHistoryBucket[] = meaningful
    .slice(0, limit)
    .map((action) => ({ kind: "action" as const, action }));

  if (technical.length > 0) {
    visible.push({
      kind: "technical_summary",
      count: technical.length,
      lastAt: technical[0]!.createdAt,
      actions: technical,
    });
  }

  return {
    visible,
    technical,
    truncatedMeaningful: truncated,
  };
}

export function formatTechnicalRefreshSummary(
  count: number,
  lastAt: string,
): string {
  const when = new Date(lastAt).toLocaleString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Candidate refreshed ${count} time${count === 1 ? "" : "s"}. Last refreshed ${when}`;
}
