"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  appendTerminalCommandHistory,
  createTerminalSession,
  fetchTerminalSessionHistory,
  listTerminalSessions,
  updateTerminalSession,
} from "@/lib/terminal/api";
import {
  formatJobSummary,
  jobEventToTerminalLine,
} from "@/lib/terminal/formatEvent";
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
import { isActiveJobStatus } from "@/lib/terminal/parseCommand";
import type { DiscoveryJob, TerminalLine } from "@/lib/terminal/types";
import type { TerminalSession as PersistedTerminalSession } from "@/lib/terminal/sessions";

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
  appendCommandHistory: (sessionId: string, command: string) => void;
};

function makeRestoredLine(
  partial: Omit<TerminalLine, "id"> & { id: string },
): TerminalLine {
  return partial;
}

function fromPersistedSession(
  session: PersistedTerminalSession,
  draft = "",
): ClientTerminalSession {
  const base = createClientSession({ title: session.title, draft });
  return {
    ...base,
    id: session.id,
    title: session.title,
    activeJobId: session.activeJobId,
    selectedJobId: session.selectedJobId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function restoreLinesForJobs(
  jobs: DiscoveryJob[],
  events: Record<string, import("@/lib/terminal/types").DiscoveryJobEvent[]>,
): {
  lines: TerminalLine[];
  lastSequence: number;
  seenEventIds: string[];
  activeJob: DiscoveryJob | null;
  lastCompletedJob: DiscoveryJob | null;
} {
  const ordered = [...jobs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lines: TerminalLine[] = [];
  const seenEventIds: string[] = [];
  let lastSequence = 0;
  let activeJob: DiscoveryJob | null = null;
  let lastCompletedJob: DiscoveryJob | null = null;

  for (const job of ordered) {
    lines.push(
      makeRestoredLine({
        id: `restored-prompt-${job.id}`,
        kind: "prompt",
        text: job.command,
        jobId: job.id,
      }),
    );
    for (const event of events[job.id] ?? []) {
      seenEventIds.push(event.id);
      lastSequence = Math.max(lastSequence, event.sequence);
      lines.push(jobEventToTerminalLine(event, `restored-${job.id}-${event.id}`));
    }
    if (isActiveJobStatus(job.status)) {
      activeJob = job;
    } else {
      lastCompletedJob = job;
      if (job.status === "completed") {
        lines.push(
          makeRestoredLine({
            id: `restored-summary-${job.id}`,
            kind: "summary",
            level: "success",
            text: formatJobSummary(job),
            jobId: job.id,
          }),
        );
      } else if (job.status === "failed") {
        lines.push(
          makeRestoredLine({
            id: `restored-failed-${job.id}`,
            kind: "error",
            level: "error",
            text: `[failed] ${job.safeErrorMessage ?? "Discovery run failed."}`,
            jobId: job.id,
          }),
        );
      } else if (job.status === "cancelled") {
        lines.push(
          makeRestoredLine({
            id: `restored-cancelled-${job.id}`,
            kind: "warning",
            level: "warning",
            text: "[cancelled] Run stopped.",
            jobId: job.id,
          }),
        );
      }
    }
  }

  return { lines, lastSequence, seenEventIds, activeJob, lastCompletedJob };
}

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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const listed = await listTerminalSessions();
        let serverSessions = listed.sessions;
        if (serverSessions.length === 0) {
          const created = await createTerminalSession({
            id: activeIdRef.current,
            title: active.title,
            select: true,
          });
          serverSessions = [created];
        }

        const restored = await Promise.all(
          serverSessions.map(async (serverSession) => {
            const local = sessions.find((s) => s.id === serverSession.id);
            const client = fromPersistedSession(serverSession, local?.draft ?? "");
            try {
              const history = await fetchTerminalSessionHistory(serverSession.id);
              const restoredLines = restoreLinesForJobs(history.jobs, history.events);
              return {
                ...client,
                lines:
                  restoredLines.lines.length > 0
                    ? restoredLines.lines
                    : client.lines,
                history: history.commandHistory.map((entry) => entry.command),
                lastSequence: restoredLines.lastSequence,
                seenEventIds: restoredLines.seenEventIds,
                activeJob: restoredLines.activeJob,
                activeJobId: restoredLines.activeJob?.id ?? serverSession.activeJobId,
                selectedJobId: serverSession.selectedJobId,
                lastCompletedJob: restoredLines.lastCompletedJob,
                lastCommand:
                  restoredLines.activeJob?.command ??
                  restoredLines.lastCompletedJob?.command ??
                  null,
                showRunActions: Boolean(restoredLines.lastCompletedJob),
              };
            } catch {
              return client;
            }
          }),
        );
        if (cancelled || restored.length === 0) return;
        setSessions(restored);
        setActiveId(
          listed.selectedSession?.id && restored.some((s) => s.id === listed.selectedSession?.id)
            ? listed.selectedSession.id
            : restored[0]!.id,
        );
      } catch {
        try {
          await createTerminalSession({
            id: activeIdRef.current,
            title: active.title,
            select: true,
          });
        } catch {
          // Local UI still works when the development repository is unavailable.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Hydrate once; later mutations are mirrored by the action callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      void createTerminalSession({
        id: session.id,
        title: session.title,
        select: true,
      }).catch(() => undefined);
      return session;
    },
    [],
  );

  const switchSession = useCallback(
    (target: string) => {
      const found = findSessionByTarget(sessions, target);
      if (!found) return null;
      setActiveId(found.id);
      void updateTerminalSession(found.id, { action: "select" }).catch(
        () => undefined,
      );
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
      void updateTerminalSession(id, { action: "rename", title: trimmed }).catch(
        () => undefined,
      );
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
      void updateTerminalSession(toClose.id, { action: "close" }).catch(
        () => undefined,
      );

      const remaining = sessions.filter((s) => s.id !== toClose.id);
      let next: ClientTerminalSession;
      if (remaining.length === 0) {
        next = createClientSession({ title: DEFAULT_TERMINAL_SESSION_NAME });
        setSessions([next]);
          setActiveId(next.id);
          persistSessionDraft(next.id, next.draft);
          void createTerminalSession({
            id: next.id,
            title: next.title,
            select: true,
          }).catch(() => undefined);
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
        void updateTerminalSession(next.id, { action: "select" }).catch(
          () => undefined,
        );
      }

      return { closed: toClose, next };
    },
    [sessions],
  );

  const appendCommandHistory = useCallback(
    (sessionId: string, command: string) => {
      void appendTerminalCommandHistory(sessionId, command).catch(
        () => undefined,
      );
    },
    [],
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
    appendCommandHistory,
  };
}
