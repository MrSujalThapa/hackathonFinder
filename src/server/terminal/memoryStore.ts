/**
 * DEV-ONLY in-memory terminal session store.
 *
 * Labeled clearly: never use as a silent production fallback.
 * Production must fail if durable session persistence is required but unavailable.
 */

import { randomUUID } from "node:crypto";
import type {
  CreateTerminalSessionInput,
  ListTerminalSessionsParams,
  TerminalCommandHistoryEntry,
  TerminalSession,
  TerminalSessionRepository,
} from "@/server/terminal/types";

type MemoryState = {
  sessions: Map<string, TerminalSession>;
  /** jobId → sessionId */
  jobLinks: Map<string, string>;
  history: Map<string, TerminalCommandHistoryEntry[]>;
  historySequences: Map<string, number>;
};

const globalState: MemoryState = {
  sessions: new Map(),
  jobLinks: new Map(),
  history: new Map(),
  historySequences: new Map(),
};

export function resetMemoryTerminalSessionStoreForTests(): void {
  globalState.sessions.clear();
  globalState.jobLinks.clear();
  globalState.history.clear();
  globalState.historySequences.clear();
}

function nowIso(): string {
  return new Date().toISOString();
}

function requireOpenSession(id: string): TerminalSession {
  const session = globalState.sessions.get(id);
  if (!session) throw new Error(`Terminal session not found: ${id}`);
  if (session.status === "closed") {
    throw new Error(`Terminal session is closed: ${id}`);
  }
  return session;
}

function requireSession(id: string): TerminalSession {
  const session = globalState.sessions.get(id);
  if (!session) throw new Error(`Terminal session not found: ${id}`);
  return session;
}

function clearSelection(): void {
  for (const [id, session] of globalState.sessions) {
    if (session.isSelected) {
      globalState.sessions.set(id, {
        ...session,
        isSelected: false,
        updatedAt: nowIso(),
      });
    }
  }
}

let memoryStoreNoticeShown = false;

export function createMemoryTerminalSessionStore(): TerminalSessionRepository {
  if (!memoryStoreNoticeShown) {
    memoryStoreNoticeShown = true;
    console.info(
      "[terminal-sessions] Using DEV-ONLY in-memory session store. Not for production persistence.",
    );
  }

  return {
    async listSessions(
      params: ListTerminalSessionsParams = {},
    ): Promise<TerminalSession[]> {
      const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
      const includeClosed = params.includeClosed === true;
      return [...globalState.sessions.values()]
        .filter((s) => includeClosed || s.status === "open")
        .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
        .slice(0, limit);
    },

    async getSession(id: string): Promise<TerminalSession | null> {
      return globalState.sessions.get(id) ?? null;
    },

    async getSelectedSession(): Promise<TerminalSession | null> {
      for (const session of globalState.sessions.values()) {
        if (session.isSelected && session.status === "open") return session;
      }
      return null;
    },

    async createSession(
      input: CreateTerminalSessionInput = {},
    ): Promise<TerminalSession> {
      const select = input.select !== false;
      if (select) clearSelection();

      const now = nowIso();
      const session: TerminalSession = {
        id: randomUUID(),
        name: (input.name?.trim() || "Session").slice(0, 120),
        status: "open",
        isSelected: select,
        createdAt: now,
        updatedAt: now,
        lastActiveAt: now,
        closedAt: null,
        metadata: input.metadata ?? null,
      };
      globalState.sessions.set(session.id, session);
      globalState.history.set(session.id, []);
      globalState.historySequences.set(session.id, 0);
      return session;
    },

    async renameSession(id: string, name: string): Promise<TerminalSession> {
      const session = requireSession(id);
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Session name cannot be empty.");
      const updated: TerminalSession = {
        ...session,
        name: trimmed.slice(0, 120),
        updatedAt: nowIso(),
      };
      globalState.sessions.set(id, updated);
      return updated;
    },

    async closeSession(id: string): Promise<TerminalSession> {
      const session = requireSession(id);
      const now = nowIso();
      const updated: TerminalSession = {
        ...session,
        status: "closed",
        isSelected: false,
        updatedAt: now,
        closedAt: now,
      };
      globalState.sessions.set(id, updated);
      return updated;
    },

    async selectSession(id: string): Promise<TerminalSession> {
      const session = requireOpenSession(id);
      clearSelection();
      const now = nowIso();
      const updated: TerminalSession = {
        ...session,
        isSelected: true,
        updatedAt: now,
        lastActiveAt: now,
      };
      globalState.sessions.set(id, updated);
      return updated;
    },

    async touchSession(id: string): Promise<TerminalSession> {
      const session = requireOpenSession(id);
      const now = nowIso();
      const updated: TerminalSession = {
        ...session,
        updatedAt: now,
        lastActiveAt: now,
      };
      globalState.sessions.set(id, updated);
      return updated;
    },

    async linkJob(sessionId: string, jobId: string): Promise<void> {
      requireSession(sessionId);
      globalState.jobLinks.set(jobId, sessionId);
      const session = globalState.sessions.get(sessionId);
      if (session && session.status === "open") {
        const now = nowIso();
        globalState.sessions.set(sessionId, {
          ...session,
          updatedAt: now,
          lastActiveAt: now,
        });
      }
    },

    async listSessionJobIds(
      sessionId: string,
      options: { limit?: number } = {},
    ): Promise<string[]> {
      requireSession(sessionId);
      const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
      const ids: string[] = [];
      for (const [jobId, sid] of globalState.jobLinks) {
        if (sid === sessionId) ids.push(jobId);
      }
      return ids.slice(0, limit);
    },

    async appendCommandHistory(
      sessionId: string,
      command: string,
    ): Promise<TerminalCommandHistoryEntry> {
      requireOpenSession(sessionId);
      const trimmed = command.trim();
      if (!trimmed) throw new Error("Command history entry cannot be empty.");

      const next = (globalState.historySequences.get(sessionId) ?? 0) + 1;
      globalState.historySequences.set(sessionId, next);

      const entry: TerminalCommandHistoryEntry = {
        id: randomUUID(),
        sessionId,
        command: trimmed.slice(0, 2_000),
        sequence: next,
        createdAt: nowIso(),
      };
      const list = globalState.history.get(sessionId) ?? [];
      list.push(entry);
      // Cap in-memory history to avoid unbounded growth in long-lived dev servers.
      if (list.length > 500) list.splice(0, list.length - 500);
      globalState.history.set(sessionId, list);
      return entry;
    },

    async listCommandHistory(
      sessionId: string,
      options: { limit?: number } = {},
    ): Promise<TerminalCommandHistoryEntry[]> {
      requireSession(sessionId);
      const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
      const list = globalState.history.get(sessionId) ?? [];
      return list.slice(-limit);
    },
  };
}
