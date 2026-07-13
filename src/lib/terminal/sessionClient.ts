/**
 * In-browser multi-session terminal state until HTTP session APIs exist.
 * Drafts + session meta persist in localStorage; lines/history stay in memory.
 */

import type { DiscoveryJob, TerminalLine } from "@/lib/terminal/types";
import { DEFAULT_TERMINAL_SESSION_NAME } from "@/lib/terminal/sessions";

export const TERMINAL_DRAFTS_STORAGE_KEY = "hf.terminal.sessionDrafts.v1";
export const TERMINAL_META_STORAGE_KEY = "hf.terminal.sessionMeta.v1";

export type ClientTerminalSession = {
  id: string;
  title: string;
  lines: TerminalLine[];
  history: string[];
  draft: string;
  activeJobId: string | null;
  selectedJobId: string | null;
  lastSequence: number;
  scrollTop: number;
  /** Serialized for React state (Set rebuilt when attaching streams). */
  seenEventIds: string[];
  activeJob: DiscoveryJob | null;
  lastCompletedJob: DiscoveryJob | null;
  lastCommand: string | null;
  showRunActions: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TerminalSessionMeta = {
  id: string;
  title: string;
  activeJobId?: string | null;
  selectedJobId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TerminalSessionsPersist = {
  activeId: string;
  sessions: TerminalSessionMeta[];
};

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `term-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function welcomeLine(): TerminalLine {
  return {
    id: `welcome-${Date.now()}`,
    kind: "system",
    text: "Discovery console ready. Natural language or /help.",
  };
}

export function createClientSession(
  partial?: Partial<Pick<ClientTerminalSession, "title" | "draft">>,
): ClientTerminalSession {
  const now = new Date().toISOString();
  const title =
    partial?.title?.trim() ||
    `${DEFAULT_TERMINAL_SESSION_NAME} ${Math.floor(Math.random() * 90) + 10}`;
  return {
    id: newId(),
    title,
    lines: [welcomeLine()],
    history: [],
    draft: partial?.draft ?? "",
    activeJobId: null,
    selectedJobId: null,
    lastSequence: 0,
    scrollTop: 0,
    seenEventIds: [],
    activeJob: null,
    lastCompletedJob: null,
    lastCommand: null,
    showRunActions: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function touchSession(
  session: ClientTerminalSession,
): ClientTerminalSession {
  return { ...session, updatedAt: new Date().toISOString() };
}

/** Match /switch and /close targets by id prefix or case-insensitive title. */
export function findSessionByTarget(
  sessions: ClientTerminalSession[],
  target: string,
): ClientTerminalSession | null {
  const needle = target.trim().toLowerCase();
  if (!needle) return null;
  const byId = sessions.find(
    (s) => s.id === target || s.id.toLowerCase().startsWith(needle),
  );
  if (byId) return byId;
  return (
    sessions.find((s) => s.title.toLowerCase() === needle) ??
    sessions.find((s) => s.title.toLowerCase().startsWith(needle)) ??
    null
  );
}

export function formatSessionListLine(
  session: ClientTerminalSession,
  activeId: string,
): string {
  const mark = session.id === activeId ? "*" : " ";
  const job = session.activeJobId
    ? ` job=${session.activeJobId.slice(0, 8)}`
    : "";
  return `${mark} ${session.id.slice(0, 8)}  ${session.title}${job}`;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function loadDraftMap(): Record<string, string> {
  if (!canUseStorage()) return {};
  try {
    const raw = localStorage.getItem(TERMINAL_DRAFTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveDraftMap(drafts: Record<string, string>): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(TERMINAL_DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // Quota / private mode — ignore.
  }
}

export function persistSessionDraft(
  sessionId: string,
  draft: string,
): void {
  const map = loadDraftMap();
  if (draft) {
    map[sessionId] = draft;
  } else {
    delete map[sessionId];
  }
  saveDraftMap(map);
}

export function removeSessionDraft(sessionId: string): void {
  const map = loadDraftMap();
  if (!(sessionId in map)) return;
  delete map[sessionId];
  saveDraftMap(map);
}

export function loadSessionMeta(): TerminalSessionsPersist | null {
  if (!canUseStorage()) return null;
  try {
    const raw = localStorage.getItem(TERMINAL_META_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TerminalSessionsPersist;
    if (
      !parsed ||
      typeof parsed.activeId !== "string" ||
      !Array.isArray(parsed.sessions) ||
      parsed.sessions.length === 0
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSessionMeta(persist: TerminalSessionsPersist): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(TERMINAL_META_STORAGE_KEY, JSON.stringify(persist));
  } catch {
    // ignore
  }
}

/** Bootstrap open sessions from meta + drafts (lines start fresh). */
export function bootstrapClientSessions(): {
  sessions: ClientTerminalSession[];
  activeId: string;
} {
  const drafts = loadDraftMap();
  const meta = loadSessionMeta();
  if (meta) {
    const sessions = meta.sessions.map((m) => {
      const base = createClientSession({ title: m.title });
      return {
        ...base,
        id: m.id,
        title: m.title,
        draft: drafts[m.id] ?? "",
        activeJobId: m.activeJobId ?? null,
        selectedJobId: m.selectedJobId ?? m.activeJobId ?? null,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      };
    });
    const activeId =
      sessions.find((s) => s.id === meta.activeId)?.id ?? sessions[0]!.id;
    return { sessions, activeId };
  }

  const first = createClientSession({
    title: DEFAULT_TERMINAL_SESSION_NAME,
  });
  first.draft = drafts[first.id] ?? "";
  return { sessions: [first], activeId: first.id };
}

export function metaFromSessions(
  sessions: ClientTerminalSession[],
  activeId: string,
): TerminalSessionsPersist {
  return {
    activeId,
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      activeJobId: s.activeJobId,
      selectedJobId: s.selectedJobId,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })),
  };
}
