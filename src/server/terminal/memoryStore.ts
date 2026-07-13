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
  /** jobId -> sessionId */
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

function sanitizeTitle(input?: string): string {
  return (input?.trim() || "Session").slice(0, 120);
}

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object") return {};
  const encoded = JSON.stringify(metadata);
  if (encoded.length > 4_096) {
    return { truncated: true };
  }
  return metadata;
}

function sortSessions(a: TerminalSession, b: TerminalSession): number {
  if (a.status !== b.status) return a.status === "open" ? -1 : 1;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return (b.lastSelectedAt ?? b.updatedAt).localeCompare(
    a.lastSelectedAt ?? a.updatedAt,
  );
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

function clearSelection(now = nowIso()): void {
  for (const [id, session] of globalState.sessions) {
    if (session.isSelected) {
      globalState.sessions.set(id, {
        ...session,
        isSelected: false,
        updatedAt: now,
      });
    }
  }
}

let memoryStoreNoticeShown = false;

export function createMemoryTerminalSessionStore(): TerminalSessionRepository {
  if (!memoryStoreNoticeShown) {
    memoryStoreNoticeShown = true;
    console.info(
      "Terminal persistence is using the development memory store.\nApply migration 007 for durable sessions.",
    );
  }

  const repo: TerminalSessionRepository = {
    async listSessions(
      params: ListTerminalSessionsParams = {},
    ): Promise<TerminalSession[]> {
      const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
      const includeClosed = params.includeClosed === true;
      return [...globalState.sessions.values()]
        .filter((s) => includeClosed || s.status === "open")
        .sort(sortSessions)
        .slice(0, limit);
    },

    async getSession(id: string): Promise<TerminalSession | null> {
      return globalState.sessions.get(id) ?? null;
    },

    async findSessionByTitleOrId(target: string): Promise<TerminalSession | null> {
      const needle = target.trim().toLowerCase();
      if (!needle) return null;
      const sessions = [...globalState.sessions.values()];
      return (
        sessions.find((s) => s.id === target || s.id.toLowerCase().startsWith(needle)) ??
        sessions.find((s) => s.title.toLowerCase() === needle) ??
        sessions.find((s) => s.title.toLowerCase().startsWith(needle)) ??
        null
      );
    },

    async getSelectedSession(): Promise<TerminalSession | null> {
      for (const session of globalState.sessions.values()) {
        if (session.isSelected && session.status === "open") return session;
      }
      return repo.restoreLatestSelectedSession();
    },

    async restoreLatestSelectedSession(): Promise<TerminalSession | null> {
      return (
        [...globalState.sessions.values()]
          .filter((session) => session.status === "open")
          .sort((a, b) =>
            (b.lastSelectedAt ?? b.updatedAt).localeCompare(
              a.lastSelectedAt ?? a.updatedAt,
            ),
          )[0] ?? null
      );
    },

    async createSession(
      input: CreateTerminalSessionInput = {},
    ): Promise<TerminalSession> {
      const select = input.select !== false;
      const now = nowIso();
      if (select) clearSelection(now);

      const session: TerminalSession = {
        id: input.id ?? randomUUID(),
        title: sanitizeTitle(input.title ?? input.name),
        status: "open",
        activeJobId: null,
        selectedJobId: null,
        isSelected: select,
        createdAt: now,
        updatedAt: now,
        closedAt: null,
        lastSelectedAt: select ? now : null,
        sortOrder: input.sortOrder ?? globalState.sessions.size,
        metadata: sanitizeMetadata(input.metadata),
      };
      if (globalState.sessions.has(session.id)) {
        throw new Error(`Terminal session already exists: ${session.id}`);
      }
      globalState.sessions.set(session.id, session);
      globalState.history.set(session.id, []);
      globalState.historySequences.set(session.id, 0);
      return session;
    },

    async renameSession(id: string, title: string): Promise<TerminalSession> {
      const session = requireSession(id);
      const trimmed = title.trim();
      if (!trimmed) throw new Error("Session title cannot be empty.");
      const updated: TerminalSession = {
        ...session,
        title: trimmed.slice(0, 120),
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

    async reopenSession(id: string): Promise<TerminalSession> {
      const session = requireSession(id);
      const now = nowIso();
      const updated: TerminalSession = {
        ...session,
        status: "open",
        updatedAt: now,
        closedAt: null,
      };
      globalState.sessions.set(id, updated);
      return updated;
    },

    async selectSession(id: string): Promise<TerminalSession> {
      const session = requireOpenSession(id);
      const now = nowIso();
      clearSelection(now);
      const updated: TerminalSession = {
        ...session,
        isSelected: true,
        updatedAt: now,
        lastSelectedAt: now,
      };
      globalState.sessions.set(id, updated);
      return updated;
    },

    async touchSession(id: string): Promise<TerminalSession> {
      const session = requireOpenSession(id);
      const updated: TerminalSession = {
        ...session,
        updatedAt: nowIso(),
      };
      globalState.sessions.set(id, updated);
      return updated;
    },

    async attachJob(sessionId: string, jobId: string): Promise<TerminalSession> {
      const session = requireSession(sessionId);
      globalState.jobLinks.set(jobId, sessionId);
      const now = nowIso();
      const updated: TerminalSession = {
        ...session,
        activeJobId: jobId,
        selectedJobId: jobId,
        updatedAt: now,
      };
      globalState.sessions.set(sessionId, updated);
      return updated;
    },

    async linkJob(sessionId: string, jobId: string): Promise<void> {
      await repo.attachJob(sessionId, jobId);
    },

    async detachCompletedActiveJob(
      sessionId: string,
      jobId: string,
    ): Promise<TerminalSession> {
      const session = requireSession(sessionId);
      const updated: TerminalSession = {
        ...session,
        activeJobId: session.activeJobId === jobId ? null : session.activeJobId,
        selectedJobId: session.selectedJobId ?? jobId,
        updatedAt: nowIso(),
      };
      globalState.sessions.set(sessionId, updated);
      return updated;
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
      return ids.slice(-limit).reverse();
    },

    async listTerminalHistory(
      sessionId: string,
      options: { limit?: number } = {},
    ): Promise<string[]> {
      return repo.listSessionJobIds(sessionId, options);
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

  return repo;
}
