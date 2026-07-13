/**
 * Terminal session persistence types + repository contract.
 *
 * Durable store requires migration 007_terminal_sessions.sql.
 */

export const TERMINAL_SESSION_STATUSES = ["open", "closed"] as const;

export type TerminalSessionStatus = (typeof TERMINAL_SESSION_STATUSES)[number];

export type TerminalSession = {
  id: string;
  name: string;
  status: TerminalSessionStatus;
  isSelected: boolean;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string;
  closedAt: string | null;
  metadata: Record<string, unknown> | null;
};

export type CreateTerminalSessionInput = {
  name?: string;
  /** When true (default), this session becomes the sole selected session. */
  select?: boolean;
  metadata?: Record<string, unknown>;
};

export type ListTerminalSessionsParams = {
  /** Include closed sessions (default false — open only). */
  includeClosed?: boolean;
  limit?: number;
};

export type TerminalCommandHistoryEntry = {
  id: string;
  sessionId: string;
  command: string;
  sequence: number;
  createdAt: string;
};

export type TerminalSessionRepository = {
  listSessions: (
    params?: ListTerminalSessionsParams,
  ) => Promise<TerminalSession[]>;
  getSession: (id: string) => Promise<TerminalSession | null>;
  getSelectedSession: () => Promise<TerminalSession | null>;
  createSession: (
    input?: CreateTerminalSessionInput,
  ) => Promise<TerminalSession>;
  renameSession: (id: string, name: string) => Promise<TerminalSession>;
  closeSession: (id: string) => Promise<TerminalSession>;
  /** Mark session selected; clears selection on all others. */
  selectSession: (id: string) => Promise<TerminalSession>;
  touchSession: (id: string) => Promise<TerminalSession>;

  /** Attach a discovery job to a session (sets discovery_jobs.terminal_session_id). */
  linkJob: (sessionId: string, jobId: string) => Promise<void>;
  listSessionJobIds: (
    sessionId: string,
    options?: { limit?: number },
  ) => Promise<string[]>;

  appendCommandHistory: (
    sessionId: string,
    command: string,
  ) => Promise<TerminalCommandHistoryEntry>;
  listCommandHistory: (
    sessionId: string,
    options?: { limit?: number },
  ) => Promise<TerminalCommandHistoryEntry[]>;
};
