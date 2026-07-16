"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MacTerminalChrome } from "@/components/terminal/MacTerminalChrome";
import { TerminalInput } from "@/components/terminal/TerminalInput";
import { TerminalOutput } from "@/components/terminal/TerminalOutput";
import { TerminalRunActions } from "@/components/terminal/TerminalRunActions";
import { TerminalSourceRail } from "@/components/terminal/TerminalSourceRail";
import { TerminalTabStrip } from "@/components/terminal/TerminalTabStrip";
import { useTerminalSessions } from "@/hooks/useTerminalSessions";
import { fetchCandidates } from "@/lib/api/candidates";
import { replaceQueue } from "@/lib/candidates/clientStore";
import {
  cancelDiscoveryJob,
  createDiscoveryJob,
  DiscoveryApiError,
  fetchSourceHealth,
  getDiscoveryJob,
  listDiscoveryJobs,
  runTerminalSiteCommand,
  runTerminalSourceCommand,
  streamJobEvents,
} from "@/lib/terminal/api";
import {
  formatHistoryLine,
  formatJobSummary,
  formatStatusLine,
  jobEventToTerminalLine,
  shouldSuppressTerminalEvent,
} from "@/lib/terminal/formatEvent";
import { formatHelpText } from "@/lib/terminal/help";
import { cycleAutocomplete } from "@/lib/terminal/autocomplete";
import {
  isActiveJobStatus,
  parseTerminalCommand,
} from "@/lib/terminal/parseCommand";
import {
  formatQueryInterpretationLines,
  interpretDiscoveryQuery,
} from "@/lib/terminal/queryInterpretation";
import { formatSessionListLine } from "@/lib/terminal/sessionClient";
import type {
  DiscoveryJob,
  SourceHealth,
  TerminalLine,
} from "@/lib/terminal/types";

let lineCounter = 0;
function nextLineId(prefix = "line"): string {
  lineCounter += 1;
  return `${prefix}-${lineCounter}-${Date.now()}`;
}

function makeLine(
  partial: Omit<TerminalLine, "id"> & { id?: string },
): TerminalLine {
  return { id: partial.id ?? nextLineId(), ...partial };
}

function sourceCommandLine(line: {
  level: "info" | "success" | "warning" | "error";
  text: string;
}): TerminalLine {
  return makeLine({
    kind:
      line.level === "success"
        ? "success"
        : line.level === "warning"
          ? "warning"
          : line.level === "error"
            ? "error"
            : "system",
    level: line.level,
    text: line.text,
  });
}

export function DiscoveryTerminal() {
  const searchParams = useSearchParams();
  const focusJobId = searchParams.get("job");

  const {
    sessions,
    activeId,
    active,
    createSession,
    switchSession,
    renameActive,
    closeSession,
    patchSession,
    appendLines,
    setDraft,
    captureScrollTop,
    appendCommandHistory,
  } = useTerminalSessions();

  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState("");
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [sources, setSources] = useState<SourceHealth[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(true);
  const [scrollToBottomSignal, setScrollToBottomSignal] = useState(0);

  /** Session currently owning the live EventSource (not always activeId). */
  const streamingSessionIdRef = useRef<string | null>(null);
  const streamingJobIdRef = useRef<string | null>(null);
  const stopStreamRef = useRef<(() => void) | null>(null);
  const verboseStreamRef = useRef(false);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  /** Live scroll position for the active session; flushed on switch/close. */
  const liveScrollTopRef = useRef(0);

  const flushScrollTop = useCallback(() => {
    const id = activeIdRef.current;
    captureScrollTop(id, liveScrollTopRef.current);
  }, [captureScrollTop]);

  const stopStream = useCallback(() => {
    stopStreamRef.current?.();
    stopStreamRef.current = null;
    streamingSessionIdRef.current = null;
    streamingJobIdRef.current = null;
  }, []);

  const refreshQueueQuietly = useCallback(async () => {
    try {
      const data = await fetchCandidates({
        status: "NEW",
        limit: 50,
        sort: "score",
      });
      replaceQueue(data.candidates);
    } catch {
      // Queue refresh is best-effort after a successful discovery run.
    }
  }, []);

  const handleJobTerminal = useCallback(
    async (sessionId: string, job: DiscoveryJob, terminal: boolean) => {
      patchSession(sessionId, {
        activeJob: job,
        activeJobId: isActiveJobStatus(job.status) ? job.id : null,
        selectedJobId: job.id,
      });
      if (!terminal) return;

      if (streamingSessionIdRef.current === sessionId) {
        stopStream();
      }

      patchSession(sessionId, {
        activeJob: job,
        activeJobId: isActiveJobStatus(job.status) ? job.id : null,
        selectedJobId: job.id,
        showRunActions: true,
        lastCompletedJob: job,
      });

      if (job.status === "completed") {
        appendLines(sessionId, [
          makeLine({
            kind: "summary",
            level: "success",
            text: formatJobSummary(job),
            jobId: job.id,
          }),
        ]);
        // Dry-run must not invalidate Queue / Sheets as if records were written.
        const isDryRun = job.dryRun === true || job.summary?.dryRun === true;
        if (!isDryRun) {
          void refreshQueueQuietly();
        }
      } else if (job.status === "failed") {
        appendLines(sessionId, [
          makeLine({
            kind: "error",
            level: "error",
            text: `[failed] ${job.safeErrorMessage ?? "Discovery run failed."}`,
            jobId: job.id,
          }),
        ]);
      } else if (job.status === "cancelled") {
        appendLines(sessionId, [
          makeLine({
            kind: "warning",
            level: "warning",
            text: "[cancelled] Run stopped.",
            jobId: job.id,
          }),
        ]);
      }
    },
    [appendLines, patchSession, refreshQueueQuietly, stopStream],
  );

  const attachStream = useCallback(
    (sessionId: string, jobId: string, afterSequence: number) => {
      stopStream();
      streamingSessionIdRef.current = sessionId;
      streamingJobIdRef.current = jobId;

      const finishFromServer = async () => {
        if (streamingJobIdRef.current !== jobId) return;
        const session = sessionsRef.current.find((s) => s.id === sessionId);
        try {
          const job = await getDiscoveryJob(jobId);
          await handleJobTerminal(sessionId, job, true);
        } catch {
          await handleJobTerminal(
            sessionId,
            {
              id: jobId,
              command: session?.lastCommand ?? "",
              status: "completed",
              createdAt: new Date().toISOString(),
            },
            true,
          );
        }
      };

      stopStreamRef.current = streamJobEvents(jobId, afterSequence, {
        onEvent: (event) => {
          // Guard: only the session that owns this stream receives events.
          if (streamingSessionIdRef.current !== sessionId) return;
          if (streamingJobIdRef.current !== jobId) return;
          if (shouldSuppressTerminalEvent(event, verboseStreamRef.current)) return;

          patchSession(sessionId, (s) => {
            if (s.seenEventIds.includes(event.id)) return s;
            return {
              ...s,
              seenEventIds: [...s.seenEventIds, event.id],
              lastSequence: Math.max(s.lastSequence, event.sequence),
              lines: [
                ...s.lines,
                jobEventToTerminalLine(event, nextLineId("ev")),
              ],
            };
          });
        },
        onDone: () => {
          void finishFromServer();
        },
      });
    },
    [handleJobTerminal, patchSession, stopStream],
  );

  /** Detach SSE only — jobs keep running (switch / close / unmount). */
  const detachStreamPreserveJob = useCallback(() => {
    stopStream();
  }, [stopStream]);

  const selectSession = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) return;
      const found = sessionsRef.current.find((s) => s.id === id);
      if (!found) return;
      flushScrollTop();
      detachStreamPreserveJob();
      switchSession(id);
      liveScrollTopRef.current = found.scrollTop;
      setHistoryIndex(null);
      if (
        found.activeJobId &&
        (!found.activeJob || isActiveJobStatus(found.activeJob.status))
      ) {
        attachStream(id, found.activeJobId, found.lastSequence);
      }
    },
    [attachStream, detachStreamPreserveJob, flushScrollTop, switchSession],
  );

  const startFind = useCallback(
    async (
      sessionId: string,
      request: string,
      rawDisplay: string,
      options: {
        dryRun?: boolean;
        verbose?: boolean;
        profile?: "light" | "standard" | "deep" | "exhaustive";
        remotePolicy?: "exclude" | "include" | "only" | "inferred_open";
        sources?: string[];
      } = {},
    ) => {
      if (submitting) return;

      setSubmitting(true);
      verboseStreamRef.current = options.verbose === true;
      patchSession(sessionId, {
        showRunActions: false,
        lastCommand: request,
      });
      const interpretation = interpretDiscoveryQuery({
        request,
        profile: options.profile,
        remotePolicy: options.remotePolicy,
        sources: options.sources,
        dryRun: options.dryRun,
        verbose: options.verbose,
      });
      appendLines(sessionId, [
        makeLine({ kind: "prompt", text: rawDisplay.trim() }),
        ...formatQueryInterpretationLines(interpretation).map((text) =>
          makeLine({ kind: "system", text }),
        ),
      ]);

      try {
        const job = await createDiscoveryJob({
          command: rawDisplay.trim(),
          terminalSessionId: sessionId,
          ...(options.dryRun ? { dryRun: true } : {}),
        });
        patchSession(sessionId, {
          seenEventIds: [],
          lastSequence: 0,
          activeJob: job,
          activeJobId: job.id,
          selectedJobId: job.id,
        });
        const queued =
          typeof job.progress === "number" && job.status === "queued";
        appendLines(sessionId, [
          makeLine({
            kind: "system",
            text: queued
              ? `[queued] Job ${job.id.slice(0, 8)}… waiting for execution slot`
              : `[queued] Job ${job.id.slice(0, 8)}…`,
          }),
        ]);
        if (job.effectiveSources?.length) {
          appendLines(sessionId, [
            makeLine({
              kind: "system",
              text: `[sources] ${job.effectiveSources.join(", ")}`,
            }),
          ]);
        }
        attachStream(sessionId, job.id, 0);
        setDraft(sessionId, "");
      } catch (error) {
        const message =
          error instanceof DiscoveryApiError
            ? error.message
            : "Could not start discovery. The job API may not be available yet.";
        appendLines(sessionId, [
          makeLine({
            kind: "error",
            level: "error",
            text: `[error] ${message}`,
          }),
        ]);
        setDraft(sessionId, rawDisplay);
      } finally {
        setSubmitting(false);
      }
    },
    [appendLines, attachStream, patchSession, setDraft, submitting],
  );

  const runSources = useCallback(
    async (sessionId: string) => {
      setSourcesLoading(true);
      setSourcesError(null);
      setRailCollapsed(false);
      try {
        const list = await fetchSourceHealth();
        setSources(list);
        if (list.length === 0) {
          appendLines(sessionId, [
            makeLine({
              kind: "system",
              text: "[sources] No source health data returned.",
            }),
          ]);
        } else {
          appendLines(
            sessionId,
            list.map((s) =>
              makeLine({
                kind:
                  s.status === "failed" || s.status === "unconfigured"
                    ? "error"
                    : s.status === "degraded" || s.status === "auth_required"
                      ? "warning"
                      : "system",
                level:
                  s.status === "failed" || s.status === "unconfigured"
                    ? "error"
                    : s.status === "degraded" || s.status === "auth_required"
                      ? "warning"
                      : "info",
                text: `[${s.source}] ${s.status.replace(/_/g, " ")}${s.safeMessage ? ` — ${s.safeMessage}` : ""}`,
              }),
            ),
          );
        }
      } catch (error) {
        const message =
          error instanceof DiscoveryApiError
            ? error.message
            : "Source health API unavailable.";
        setSourcesError(message);
        appendLines(sessionId, [
          makeLine({
            kind: "warning",
            level: "warning",
            text: `[sources] ${message}`,
          }),
        ]);
      } finally {
        setSourcesLoading(false);
      }
    },
    [appendLines],
  );

  const runStatus = useCallback(
    async (sessionId: string) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      try {
        if (session?.activeJobId) {
          const job = await getDiscoveryJob(session.activeJobId);
          patchSession(sessionId, { activeJob: job });
          appendLines(sessionId, [
            makeLine({ kind: "system", text: formatStatusLine(job) }),
          ]);
          if (!isActiveJobStatus(job.status)) {
            await handleJobTerminal(sessionId, job, true);
          }
          return;
        }
        const jobs = await listDiscoveryJobs();
        const latest = jobs[0];
        if (!latest) {
          appendLines(sessionId, [
            makeLine({
              kind: "system",
              text: "[status] No discovery jobs yet.",
            }),
          ]);
          return;
        }
        patchSession(sessionId, { activeJob: latest });
        appendLines(sessionId, [
          makeLine({ kind: "system", text: formatStatusLine(latest) }),
        ]);
      } catch (error) {
        const message =
          error instanceof DiscoveryApiError
            ? error.message
            : "Status API unavailable.";
        appendLines(sessionId, [
          makeLine({
            kind: "warning",
            level: "warning",
            text: `[status] ${message}`,
          }),
        ]);
      }
    },
    [appendLines, handleJobTerminal, patchSession],
  );

  const runHistory = useCallback(
    async (sessionId: string) => {
      try {
        const jobs = await listDiscoveryJobs();
        if (jobs.length === 0) {
          appendLines(sessionId, [
            makeLine({
              kind: "system",
              text: "[history] No recent jobs.",
            }),
          ]);
          return;
        }
        appendLines(
          sessionId,
          jobs
            .slice(0, 20)
            .map((job) =>
              makeLine({ kind: "system", text: formatHistoryLine(job) }),
            ),
        );
      } catch (error) {
        const message =
          error instanceof DiscoveryApiError
            ? error.message
            : "History API unavailable.";
        appendLines(sessionId, [
          makeLine({
            kind: "warning",
            level: "warning",
            text: `[history] ${message}`,
          }),
        ]);
      }
    },
    [appendLines],
  );

  const runCancel = useCallback(
    async (sessionId: string, requestedJobId?: string) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      const id = requestedJobId ?? session?.activeJobId ?? session?.activeJob?.id;
      if (!id) {
        appendLines(sessionId, [
          makeLine({
            kind: "system",
            text: "[cancel] No active discovery run.",
          }),
        ]);
        return;
      }
      try {
        const job = await cancelDiscoveryJob(id);
        patchSession(sessionId, { activeJob: job });
        appendLines(sessionId, [
          makeLine({
            kind: "warning",
            level: "warning",
            text: "[cancel] Cancellation requested.",
          }),
        ]);
        if (!isActiveJobStatus(job.status)) {
          await handleJobTerminal(sessionId, job, true);
        }
      } catch (error) {
        const message =
          error instanceof DiscoveryApiError
            ? error.message
            : "Could not cancel the run.";
        appendLines(sessionId, [
          makeLine({
            kind: "error",
            level: "error",
            text: `[cancel] ${message}`,
          }),
        ]);
      }
    },
    [appendLines, handleJobTerminal, patchSession],
  );

  const handleSessionCommand = useCallback(
    (sessionId: string, kind: string, target?: string, name?: string) => {
      if (kind === "new") {
        flushScrollTop();
        detachStreamPreserveJob();
        const created = createSession();
        liveScrollTopRef.current = 0;
        appendLines(created.id, [
          makeLine({
            kind: "system",
            text: `[session] Created “${created.title}” (${created.id.slice(0, 8)}).`,
          }),
        ]);
        setHistoryIndex(null);
        return;
      }

      if (kind === "terminals") {
        const list = sessionsRef.current;
        appendLines(sessionId, [
          makeLine({
            kind: "system",
            text: [
              "ID        TITLE",
              ...list.map((s) => formatSessionListLine(s, activeIdRef.current)),
              "",
              `${list.length} open · * = active`,
            ].join("\n"),
          }),
        ]);
        return;
      }

      if (kind === "switch" && target) {
        const found = sessionsRef.current.find(
          (s) =>
            s.id === target ||
            s.id.toLowerCase().startsWith(target.toLowerCase()) ||
            s.title.toLowerCase() === target.toLowerCase() ||
            s.title.toLowerCase().startsWith(target.toLowerCase()),
        );
        if (!found) {
          appendLines(sessionId, [
            makeLine({
              kind: "warning",
              level: "warning",
              text: `[session] No open session matching “${target}”.`,
            }),
          ]);
          return;
        }
        if (found.id === sessionId) {
          appendLines(sessionId, [
            makeLine({
              kind: "system",
              text: `[session] Already on “${found.title}”.`,
            }),
          ]);
          return;
        }
        appendLines(sessionId, [
          makeLine({
            kind: "system",
            text: `[session] Switching to “${found.title}”…`,
          }),
        ]);
        selectSession(found.id);
        queueMicrotask(() => {
          appendLines(found.id, [
            makeLine({
              kind: "system",
              text: `[session] Active: “${found.title}”.`,
            }),
          ]);
        });
        return;
      }

      if (kind === "rename" && name) {
        const renamed = renameActive(name);
        if (!renamed) {
          appendLines(sessionId, [
            makeLine({
              kind: "warning",
              level: "warning",
              text: "[session] Rename failed.",
            }),
          ]);
          return;
        }
        appendLines(sessionId, [
          makeLine({
            kind: "system",
            text: `[session] Renamed to “${name.trim()}”.`,
          }),
        ]);
        return;
      }

      if (kind === "close") {
        flushScrollTop();
        const result = closeSession(target);
        if (!result) {
          appendLines(sessionId, [
            makeLine({
              kind: "warning",
              level: "warning",
              text: target
                ? `[session] No open session matching “${target}”.`
                : "[session] Nothing to close.",
            }),
          ]);
          return;
        }
        // Keep-running: detach SSE only; do not cancel discovery jobs.
        if (
          streamingSessionIdRef.current === result.closed.id ||
          result.closed.id === sessionId
        ) {
          detachStreamPreserveJob();
        }
        setHistoryIndex(null);
        liveScrollTopRef.current = result.next.scrollTop;
        appendLines(result.next.id, [
          makeLine({
            kind: "system",
            text: `[session] Closed “${result.closed.title}” (${result.closed.id.slice(0, 8)}). Job left running if any. Now on “${result.next.title}”.`,
          }),
        ]);
        const nextSnap = result.next;
        if (
          nextSnap.activeJobId &&
          (!nextSnap.activeJob ||
            isActiveJobStatus(nextSnap.activeJob.status))
        ) {
          attachStream(
            nextSnap.id,
            nextSnap.activeJobId,
            nextSnap.lastSequence,
          );
        }
      }
    },
    [
      appendLines,
      attachStream,
      closeSession,
      createSession,
      detachStreamPreserveJob,
      flushScrollTop,
      renameActive,
      selectSession,
    ],
  );

  const submit = useCallback(async () => {
    const sessionId = activeIdRef.current;
    const session = sessionsRef.current.find((s) => s.id === sessionId);
    if (!session) return;
    const raw = session.draft;
    const parsed = parseTerminalCommand(raw);

    if (parsed.kind === "empty") return;
    setScrollToBottomSignal((value) => value + 1);

    if (parsed.kind !== "rejected" && parsed.kind !== "clear") {
      patchSession(sessionId, (s) => {
        const trimmed = raw.trim();
          const next = [
            ...s.history.filter((h) => h !== trimmed),
            trimmed,
          ].slice(-50);
          return { ...s, history: next };
        });
      appendCommandHistory(sessionId, raw.trim());
      setHistoryIndex(null);
    }

    if (parsed.kind === "rejected") {
      appendLines(sessionId, [
        makeLine({ kind: "prompt", text: raw.trim() }),
        makeLine({
          kind: "warning",
          level: "warning",
          text: parsed.suggestion
            ? `${parsed.message}\nDid you mean “${parsed.suggestion}”?`
            : parsed.message,
        }),
      ]);
      return;
    }

    if (parsed.kind === "help") {
      appendLines(sessionId, [
        makeLine({ kind: "prompt", text: raw.trim() || "/help" }),
        makeLine({
          kind: "help",
          text: formatHelpText(parsed.topic),
        }),
      ]);
      setDraft(sessionId, "");
      return;
    }

    if (parsed.kind === "clear") {
      patchSession(sessionId, {
        lines: [
          makeLine({
            kind: "system",
            text: "[clear] Scrollback cleared. Persisted jobs remain — use /history or /jobs.",
          }),
        ],
        showRunActions: false,
      });
      setDraft(sessionId, "");
      return;
    }

    if (parsed.kind === "find") {
      await startFind(sessionId, parsed.request, raw, {
        dryRun: parsed.dryRun,
        verbose: parsed.verbose,
        profile: parsed.profile,
        remotePolicy: parsed.remotePolicy,
        sources: parsed.sources,
      });
      return;
    }

    appendLines(sessionId, [makeLine({ kind: "prompt", text: raw.trim() })]);
    setDraft(sessionId, "");

    if (parsed.kind === "sources") {
      await runSources(sessionId);
      return;
    }
    if (parsed.kind === "status") {
      await runStatus(sessionId);
      return;
    }
    if (parsed.kind === "history") {
      await runHistory(sessionId);
      return;
    }
    if (parsed.kind === "jobs") {
      try {
        const jobs = await listDiscoveryJobs();
        if (jobs.length === 0) {
          appendLines(sessionId, [
            makeLine({
              kind: "system",
              text: "[jobs] No discovery jobs yet.",
            }),
          ]);
        } else {
          appendLines(sessionId, [
            makeLine({
              kind: "system",
              text: "ID        STATUS      COMMAND",
            }),
            ...jobs.slice(0, 20).map((job) =>
              makeLine({
                kind: "system",
                text: `${job.id.slice(0, 8).padEnd(10)}${job.status.padEnd(12)}${job.command.slice(0, 60)}`,
              }),
            ),
          ]);
        }
      } catch (error) {
        const message =
          error instanceof DiscoveryApiError
            ? error.message
            : "Could not list jobs.";
        appendLines(sessionId, [
          makeLine({
            kind: "error",
            level: "error",
            text: `[jobs] ${message}`,
          }),
        ]);
      }
      return;
    }
    if (parsed.kind === "cancel") {
      await runCancel(sessionId, parsed.jobId);
      return;
    }
    if (parsed.kind === "source") {
      if (parsed.action === "enable" || parsed.action === "disable") {
        appendLines(sessionId, [
          makeLine({
            kind: "system",
            text: `[source] ${parsed.action} ${parsed.source} - use Settings to change enabled sources.`,
          }),
        ]);
        return;
      }

      try {
        const result = await runTerminalSourceCommand({
          action: parsed.action,
          source: parsed.source,
          sessionId,
        });
        appendLines(sessionId, result.lines.map(sourceCommandLine));
        if (parsed.action === "status" || parsed.action === "check") {
          void runSources(sessionId);
        }
      } catch (error) {
        const message =
          error instanceof DiscoveryApiError
            ? error.message
            : "Source command failed.";
        appendLines(sessionId, [
          makeLine({
            kind: "error",
            level: "error",
            text: `[source] ${message}`,
          }),
        ]);
      }
      return;
    }
    if (parsed.kind === "site") {
      if (parsed.action === "remove") {
        appendLines(sessionId, [
          makeLine({
            kind: "warning",
            level: "warning",
            text: `[site] Confirm removal with /confirm site remove ${parsed.name}`,
          }),
        ]);
        return;
      }
      try {
        const result = await runTerminalSiteCommand({
          action: parsed.action === "list" ? "list" : parsed.action,
          name: parsed.name,
          url: parsed.url,
          mode: parsed.mode,
          location: parsed.location,
          topics: parsed.topics,
          maxItems: parsed.maxItems,
          enabled: parsed.enabled,
          selectors: parsed.selectors,
        });
        appendLines(sessionId, result.lines.map(sourceCommandLine));
      } catch (error) {
        const message =
          error instanceof DiscoveryApiError
            ? error.message
            : "Site command failed.";
        appendLines(sessionId, [
          makeLine({
            kind: "error",
            level: "error",
            text: `[site] ${message}`,
          }),
        ]);
      }
      return;
    }
    if (parsed.kind === "confirm_site") {
      try {
        const result = await runTerminalSiteCommand({
          action: "remove_confirm",
          name: parsed.name,
        });
        appendLines(sessionId, result.lines.map(sourceCommandLine));
      } catch (error) {
        const message =
          error instanceof DiscoveryApiError
            ? error.message
            : "Site confirmation failed.";
        appendLines(sessionId, [
          makeLine({
            kind: "error",
            level: "error",
            text: `[confirm] ${message}`,
          }),
        ]);
      }
      return;
    }
    if (parsed.kind === "confirm") {
      try {
        const result = await runTerminalSourceCommand({
          action: "confirm_disconnect",
          source: parsed.source,
          sessionId,
        });
        appendLines(sessionId, result.lines.map(sourceCommandLine));
      } catch (error) {
        const message =
          error instanceof DiscoveryApiError
            ? error.message
            : "Confirmation failed.";
        appendLines(sessionId, [
          makeLine({
            kind: "error",
            level: "error",
            text: `[confirm] ${message}`,
          }),
        ]);
      }
      return;
    }
    if (
      parsed.kind === "new" ||
      parsed.kind === "terminals" ||
      parsed.kind === "switch" ||
      parsed.kind === "rename" ||
      parsed.kind === "close"
    ) {
      handleSessionCommand(
        sessionId,
        parsed.kind,
        "target" in parsed ? parsed.target : undefined,
        "name" in parsed ? parsed.name : undefined,
      );
    }
  }, [
    appendLines,
    appendCommandHistory,
    handleSessionCommand,
    patchSession,
    runCancel,
    runHistory,
    runSources,
    runStatus,
    setDraft,
    startFind,
  ]);

  const onHistoryPrev = useCallback(() => {
    const session = sessionsRef.current.find(
      (s) => s.id === activeIdRef.current,
    );
    if (!session || session.history.length === 0) return;
    setHistoryIndex((idx) => {
      if (idx === null) {
        setDraftBeforeHistory(session.draft);
        const next = session.history.length - 1;
        setDraft(session.id, session.history[next] ?? "");
        return next;
      }
      const next = Math.max(0, idx - 1);
      setDraft(session.id, session.history[next] ?? "");
      return next;
    });
  }, [setDraft]);

  const onHistoryNext = useCallback(() => {
    const session = sessionsRef.current.find(
      (s) => s.id === activeIdRef.current,
    );
    if (!session || historyIndex === null) return;
    if (historyIndex >= session.history.length - 1) {
      setHistoryIndex(null);
      setDraft(session.id, draftBeforeHistory);
      return;
    }
    const next = historyIndex + 1;
    setHistoryIndex(next);
    setDraft(session.id, session.history[next] ?? "");
  }, [draftBeforeHistory, historyIndex, setDraft]);

  const onAutocomplete = useCallback(
    (value: string, cursor: number) => {
      const next = cycleAutocomplete(
        value,
        cursor,
        {
          terminalNames: sessionsRef.current.map((s) => s.title),
          recentJobIds: sessionsRef.current
            .flatMap((s) => [s.activeJobId, s.selectedJobId])
            .filter((id): id is string => Boolean(id)),
        },
        autocompleteIndex,
      );
      if (!next) return null;
      setAutocompleteIndex((idx) => idx + 1);
      return { value: next.value, cursor: next.cursor };
    },
    [autocompleteIndex],
  );

  const onRunAgain = useCallback(() => {
    const sessionId = activeIdRef.current;
    const session = sessionsRef.current.find((s) => s.id === sessionId);
    const cmd = session?.lastCommand ?? session?.lastCompletedJob?.command;
    if (!cmd) return;
    setDraft(sessionId, cmd);
    void startFind(sessionId, cmd, cmd);
  }, [setDraft, startFind]);

  const onNewTab = useCallback(() => {
    flushScrollTop();
    detachStreamPreserveJob();
    createSession();
    liveScrollTopRef.current = 0;
    setHistoryIndex(null);
  }, [createSession, detachStreamPreserveJob, flushScrollTop]);

  const onCloseTab = useCallback(
    (id: string) => {
      flushScrollTop();
      const closing = sessionsRef.current.find((s) => s.id === id);
      const result = closeSession(id);
      if (!result) return;
      if (streamingSessionIdRef.current === result.closed.id) {
        detachStreamPreserveJob();
      }
      setHistoryIndex(null);
      liveScrollTopRef.current = result.next.scrollTop;
      const nextSnap =
        sessionsRef.current.find((s) => s.id === result.next.id) ?? result.next;
      if (
        nextSnap.activeJobId &&
        (!nextSnap.activeJob ||
          isActiveJobStatus(nextSnap.activeJob.status)) &&
        nextSnap.id !== closing?.id
      ) {
        attachStream(nextSnap.id, nextSnap.activeJobId, nextSnap.lastSequence);
      }
    },
    [
      attachStream,
      closeSession,
      detachStreamPreserveJob,
      flushScrollTop,
    ],
  );

  // Reconnect restored sessions after a refresh or server-side hydration.
  useEffect(() => {
    if (!active.activeJobId) return;
    if (streamingJobIdRef.current === active.activeJobId) return;
    if (active.activeJob && !isActiveJobStatus(active.activeJob.status)) return;
    attachStream(active.id, active.activeJobId, active.lastSequence);
  }, [
    active.activeJob,
    active.activeJobId,
    active.id,
    active.lastSequence,
    attachStream,
  ]);

  // Deep-link / reconnect to a job from ?job=
  useEffect(() => {
    if (!focusJobId) return;
    let cancelled = false;
    const sessionId = activeIdRef.current;
    void (async () => {
      try {
        const job = await getDiscoveryJob(focusJobId);
        if (cancelled) return;
        patchSession(sessionId, {
          activeJob: job,
          activeJobId: isActiveJobStatus(job.status) ? job.id : null,
          selectedJobId: job.id,
          lastCommand: job.command,
        });
        appendLines(sessionId, [
          makeLine({
            kind: "system",
            text: `[view] ${formatStatusLine(job)}`,
          }),
        ]);
        if (isActiveJobStatus(job.status)) {
          patchSession(sessionId, {
            lastSequence: 0,
            seenEventIds: [],
          });
          attachStream(sessionId, job.id, 0);
        } else {
          patchSession(sessionId, {
            lastCompletedJob: job,
            showRunActions: true,
          });
          if (job.status === "completed") {
            appendLines(sessionId, [
              makeLine({
                kind: "summary",
                text: formatJobSummary(job),
                jobId: job.id,
              }),
            ]);
          }
        }
      } catch {
        if (!cancelled) {
          appendLines(sessionId, [
            makeLine({
              kind: "warning",
              level: "warning",
              text: `[view] Could not load job ${focusJobId.slice(0, 8)}.`,
            }),
          ]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally once per focusJobId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusJobId]);

  useEffect(() => () => stopStream(), [stopStream]);

  const live = Boolean(
    active.activeJob && isActiveJobStatus(active.activeJob.status),
  );
  const windowStatus = active.activeJob
    ? `${active.activeJob.status} · ${active.activeJob.id.slice(0, 8)}`
    : "idle";

  return (
    <div className="mac-terminal-page mx-auto flex w-full max-w-[96rem] flex-1 flex-col gap-3 lg:gap-4">
      <h1 className="sr-only">Discovery terminal</h1>

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:items-stretch">
        <MacTerminalChrome
          className="flex h-[min(82dvh,52rem)] min-h-0 flex-1 flex-col lg:h-[min(88dvh,58rem)]"
          title={`hackfinder — ${active.title} — 120×40`}
          status={live ? `running · ${windowStatus}` : windowStatus}
        >
          <TerminalTabStrip
            sessions={sessions.map((s) => ({
              id: s.id,
              title: s.title,
              busy: Boolean(
                s.activeJobId &&
                  s.activeJob &&
                  isActiveJobStatus(s.activeJob.status),
              ),
            }))}
            activeId={activeId}
            onSelect={selectSession}
            onNew={onNewTab}
            onClose={onCloseTab}
          />
          <TerminalOutput
            key={activeId}
            lines={active.lines}
            live={live}
            scrollTop={active.scrollTop}
            scrollToBottomSignal={scrollToBottomSignal}
            onScrollTopChange={(top) => {
              liveScrollTopRef.current = top;
            }}
          />
          <TerminalRunActions
            visible={active.showRunActions}
            jobId={active.lastCompletedJob?.id ?? active.activeJob?.id ?? null}
            onRunAgain={onRunAgain}
          />
          <TerminalInput
            value={active.draft}
            onChange={(value) => setDraft(activeId, value)}
            onSubmit={() => void submit()}
            onHistoryPrev={onHistoryPrev}
            onHistoryNext={onHistoryNext}
            onAutocomplete={onAutocomplete}
            disabled={false}
            busy={submitting}
          />
        </MacTerminalChrome>

        <div className="lg:flex lg:flex-col lg:gap-3">
          <TerminalSourceRail
            sources={sources}
            collapsed={railCollapsed}
            onToggle={() => setRailCollapsed((v) => !v)}
            loading={sourcesLoading}
            error={sourcesError}
          />
        </div>
      </div>
    </div>
  );
}
