/**
 * Client-side terminal session types and helpers.
 * Mirrors the server repository contract for future session APIs / UI wiring.
 */

export type TerminalSessionStatus = "open" | "closed";

export type TerminalSession = {
  id: string;
  title: string;
  status: TerminalSessionStatus;
  activeJobId: string | null;
  selectedJobId: string | null;
  isSelected: boolean;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  lastSelectedAt?: string | null;
  sortOrder: number;
  metadata?: Record<string, unknown> | null;
};

export type TerminalCommandHistoryEntry = {
  id: string;
  sessionId: string;
  command: string;
  sequence: number;
  createdAt: string;
};

export type CreateTerminalSessionInput = {
  title?: string;
  select?: boolean;
};

export type ListTerminalSessionsResult = {
  sessions: TerminalSession[];
};

export type GetTerminalSessionResult = {
  session: TerminalSession;
};

export type TerminalSessionHistoryResult = {
  history: TerminalCommandHistoryEntry[];
};

/** Default display name when the user has not renamed a session. */
export const DEFAULT_TERMINAL_SESSION_NAME = "Session";

export function isOpenTerminalSession(
  session: Pick<TerminalSession, "status">,
): boolean {
  return session.status === "open";
}

export function sortTerminalSessionsByActivity(
  sessions: TerminalSession[],
): TerminalSession[] {
  return [...sessions].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return (b.lastSelectedAt ?? b.updatedAt).localeCompare(
      a.lastSelectedAt ?? a.updatedAt,
    );
  });
}

/** Chronological command strings for arrow-up recall (oldest → newest). */
export function commandStringsFromHistory(
  entries: TerminalCommandHistoryEntry[],
): string[] {
  return entries.map((entry) => entry.command);
}

export function findSelectedTerminalSession(
  sessions: TerminalSession[],
): TerminalSession | null {
  return (
    sessions.find((session) => session.isSelected && isOpenTerminalSession(session)) ??
    null
  );
}
