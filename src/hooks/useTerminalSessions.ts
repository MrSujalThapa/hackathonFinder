"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bootstrapClientSessions,
  createClientSession,
  findSessionByTarget,
  metaFromSessions,
  persistSessionDraft,
  removeSessionDraft,
  saveSessionMeta,
  touchSession,
  type ClientTerminalSession,
} from "@/lib/terminal/sessionClient";
import { DEFAULT_TERMINAL_SESSION_NAME } from "@/lib/terminal/sessions";
import type { TerminalLine } from "@/lib/terminal/types";

export type UseTerminalSessionsResult = {
  sessions: ClientTerminalSession[];
  activeId: string;
  active: ClientTerminalSession;
  titles: string[];
  createSession: (title?: string) => ClientTerminalSession;
  switchSession: (target: string) => ClientTerminalSession | null;
  renameActive: (name: string) => ClientTerminalSession | null;
  /** Close by id/name or active. Does not cancel jobs (keep-running). */
  closeSession: (target?: string) => {
    closed: ClientTerminalSession;
    next: ClientTerminalSession;
  } | null;
  patchSession: (
    sessionId: string,
    patch:
      | Partial<ClientTerminalSession>
      | ((prev: ClientTerminalSession) => ClientTerminalSession),
  ) => void;
  appendLines: (sessionId: string, lines: TerminalLine[]) => void;
  setDraft: (sessionId: string, draft: string) => void;
  captureScrollTop: (sessionId: string, scrollTop: number) => void;
};

export function useTerminalSessions(): UseTerminalSessionsResult {
  const [boot] = useState(() => bootstrapClientSessions());
  const [sessions, setSessions] = useState<ClientTerminalSession[]>(
    () => boot.sessions,
  );
  const [activeId, setActiveId] = useState(() => boot.activeId);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const active = useMemo(() => {
    return (
      sessions.find((s) => s.id === activeId) ??
      sessions[0] ??
      createClientSession({ title: DEFAULT_TERMINAL_SESSION_NAME })
    );
  }, [sessions, activeId]);

  const titles = useMemo(() => sessions.map((s) => s.title), [sessions]);

  useEffect(() => {
    saveSessionMeta(metaFromSessions(sessions, activeId));
  }, [sessions, activeId]);

  const patchSession = useCallback(
    (
      sessionId: string,
      patch:
        | Partial<ClientTerminalSession>
        | ((prev: ClientTerminalSession) => ClientTerminalSession),
    ) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const next =
            typeof patch === "function" ? patch(s) : { ...s, ...patch };
          return touchSession(next);
        }),
      );
    },
    [],
  );

  const appendLines = useCallback(
    (sessionId: string, lines: TerminalLine[]) => {
      if (lines.length === 0) return;
      patchSession(sessionId, (s) => ({
        ...s,
        lines: [...s.lines, ...lines],
      }));
    },
    [patchSession],
  );

  const setDraft = useCallback(
    (sessionId: string, draft: string) => {
      patchSession(sessionId, { draft });
      persistSessionDraft(sessionId, draft);
    },
    [patchSession],
  );

  const captureScrollTop = useCallback(
    (sessionId: string, scrollTop: number) => {
      patchSession(sessionId, { scrollTop });
    },
    [patchSession],
  );

  const createSession = useCallback(
    (title?: string) => {
      const session = createClientSession(
        title ? { title } : undefined,
      );
      setSessions((prev) => [...prev, session]);
      setActiveId(session.id);
      persistSessionDraft(session.id, session.draft);
      return session;
    },
    [],
  );

  const switchSession = useCallback(
    (target: string) => {
      const found = findSessionByTarget(sessions, target);
      if (!found) return null;
      setActiveId(found.id);
      return found;
    },
    [sessions],
  );

  const renameActive = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const id = activeIdRef.current;
      patchSession(id, { title: trimmed });
      return { ...active, title: trimmed };
    },
    [active, patchSession],
  );

  const closeSession = useCallback(
    (target?: string) => {
      const toClose = target
        ? findSessionByTarget(sessions, target)
        : sessions.find((s) => s.id === activeIdRef.current) ?? null;
      if (!toClose) return null;

      removeSessionDraft(toClose.id);

      const remaining = sessions.filter((s) => s.id !== toClose.id);
      let next: ClientTerminalSession;
      if (remaining.length === 0) {
        next = createClientSession({ title: DEFAULT_TERMINAL_SESSION_NAME });
        setSessions([next]);
        setActiveId(next.id);
        persistSessionDraft(next.id, next.draft);
      } else {
        const idx = sessions.findIndex((s) => s.id === toClose.id);
        next =
          toClose.id === activeIdRef.current
            ? remaining[Math.min(Math.max(idx, 0), remaining.length - 1)] ??
              remaining[0]!
            : remaining.find((s) => s.id === activeIdRef.current) ??
              remaining[0]!;
        setSessions(remaining);
        setActiveId(next.id);
      }

      return { closed: toClose, next };
    },
    [sessions],
  );

  return {
    sessions,
    activeId,
    active,
    titles,
    createSession,
    switchSession,
    renameActive,
    closeSession,
    patchSession,
    appendLines,
    setDraft,
    captureScrollTop,
  };
}
