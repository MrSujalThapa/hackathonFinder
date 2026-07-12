"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BlueprintPanel } from "@/components/blueprint/BlueprintPanel";
import { TechnicalLabel } from "@/components/blueprint/TechnicalLabel";
import { TerminalInput } from "@/components/terminal/TerminalInput";
import { TerminalOutput } from "@/components/terminal/TerminalOutput";
import { TerminalRunActions } from "@/components/terminal/TerminalRunActions";
import { TerminalSourceRail } from "@/components/terminal/TerminalSourceRail";
import {
  cancelDiscoveryJob,
  createDiscoveryJob,
  DiscoveryApiError,
  fetchSourceHealth,
  getDiscoveryJob,
  listDiscoveryJobs,
  streamJobEvents,
} from "@/lib/terminal/api";
import {
  formatHistoryLine,
  formatJobSummary,
  formatStatusLine,
  jobEventToTerminalLine,
} from "@/lib/terminal/formatEvent";
import { TERMINAL_HELP_LINES } from "@/lib/terminal/help";
import {
  isActiveJobStatus,
  parseTerminalCommand,
} from "@/lib/terminal/parseCommand";
import { fetchCandidates } from "@/lib/api/candidates";
import { replaceQueue } from "@/lib/candidates/clientStore";
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

export function DiscoveryTerminal() {
  const searchParams = useSearchParams();
  const focusJobId = searchParams.get("job");

  const [lines, setLines] = useState<TerminalLine[]>(() => [
    makeLine({
      kind: "system",
      text: "Discovery console ready. Natural language or /help.",
    }),
  ]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeJob, setActiveJob] = useState<DiscoveryJob | null>(null);
  const [lastCompletedJob, setLastCompletedJob] = useState<DiscoveryJob | null>(
    null,
  );
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceHealth[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(true);
  const [showRunActions, setShowRunActions] = useState(false);

  const activeJobIdRef = useRef<string | null>(null);
  const lastSequenceRef = useRef(0);
  const seenEventIdsRef = useRef(new Set<string>());
  const stopStreamRef = useRef<(() => void) | null>(null);

  const appendLines = useCallback((next: TerminalLine[]) => {
    setLines((prev) => [...prev, ...next]);
  }, []);

  const stopStream = useCallback(() => {
    stopStreamRef.current?.();
    stopStreamRef.current = null;
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
    async (job: DiscoveryJob, terminal: boolean) => {
      setActiveJob(job);
      if (!terminal) return;

      stopStream();
      activeJobIdRef.current = null;
      setShowRunActions(true);
      setLastCompletedJob(job);

      if (job.status === "completed") {
        appendLines([
          makeLine({
            kind: "summary",
            level: "success",
            text: formatJobSummary(job),
            jobId: job.id,
          }),
        ]);
        void refreshQueueQuietly();
      } else if (job.status === "failed") {
        appendLines([
          makeLine({
            kind: "error",
            level: "error",
            text: `[failed] ${job.safeErrorMessage ?? "Discovery run failed."}`,
            jobId: job.id,
          }),
        ]);
      } else if (job.status === "cancelled") {
        appendLines([
          makeLine({
            kind: "warning",
            level: "warning",
            text: "[cancelled] Run stopped.",
            jobId: job.id,
          }),
        ]);
      }
    },
    [appendLines, refreshQueueQuietly, stopStream],
  );

  const attachStream = useCallback(
    (jobId: string) => {
      stopStream();
      activeJobIdRef.current = jobId;

      const finishFromServer = async () => {
        if (activeJobIdRef.current !== jobId) return;
        try {
          const job = await getDiscoveryJob(jobId);
          await handleJobTerminal(job, true);
        } catch {
          await handleJobTerminal(
            {
              id: jobId,
              command: lastCommand ?? "",
              status: "completed",
              createdAt: new Date().toISOString(),
            },
            true,
          );
        }
      };

      stopStreamRef.current = streamJobEvents(jobId, lastSequenceRef.current, {
        onEvent: (event) => {
          if (seenEventIdsRef.current.has(event.id)) return;
          seenEventIdsRef.current.add(event.id);
          if (event.sequence > lastSequenceRef.current) {
            lastSequenceRef.current = event.sequence;
          }
          appendLines([jobEventToTerminalLine(event, nextLineId("ev"))]);
        },
        onDone: () => {
          void finishFromServer();
        },
      });
    },
    [appendLines, handleJobTerminal, lastCommand, stopStream],
  );

  const startFind = useCallback(
    async (request: string, rawDisplay: string) => {
      if (submitting) return;
      if (activeJob && isActiveJobStatus(activeJob.status)) {
        appendLines([
          makeLine({
            kind: "warning",
            level: "warning",
            text: "A discovery run is already active. Use /cancel first, or wait for it to finish.",
          }),
        ]);
        setInput(rawDisplay);
        return;
      }

      setSubmitting(true);
      setShowRunActions(false);
      setLastCommand(request);
      appendLines([makeLine({ kind: "prompt", text: rawDisplay.trim() })]);

      try {
        const job = await createDiscoveryJob({ command: request });
        seenEventIdsRef.current = new Set();
        lastSequenceRef.current = 0;
        setActiveJob(job);
        activeJobIdRef.current = job.id;
        appendLines([
          makeLine({
            kind: "system",
            text: `[queued] Job ${job.id.slice(0, 8)}…`,
          }),
        ]);
        if (job.effectiveSources?.length) {
          appendLines([
            makeLine({
              kind: "system",
              text: `[sources] ${job.effectiveSources.join(", ")}`,
            }),
          ]);
        }
        attachStream(job.id);
        setInput("");
      } catch (error) {
        const message =
          error instanceof DiscoveryApiError
            ? error.message
            : "Could not start discovery. The job API may not be available yet.";
        appendLines([
          makeLine({ kind: "error", level: "error", text: `[error] ${message}` }),
        ]);
        // Preserve command on failure.
        setInput(rawDisplay);
      } finally {
        setSubmitting(false);
      }
    },
    [activeJob, appendLines, attachStream, submitting],
  );

  const runSources = useCallback(async () => {
    setSourcesLoading(true);
    setSourcesError(null);
    setRailCollapsed(false);
    try {
      const list = await fetchSourceHealth();
      setSources(list);
      if (list.length === 0) {
        appendLines([
          makeLine({
            kind: "system",
            text: "[sources] No source health data returned.",
          }),
        ]);
      } else {
        appendLines(
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
      appendLines([
        makeLine({
          kind: "warning",
          level: "warning",
          text: `[sources] ${message}`,
        }),
      ]);
    } finally {
      setSourcesLoading(false);
    }
  }, [appendLines]);

  const runStatus = useCallback(async () => {
    try {
      if (activeJobIdRef.current) {
        const job = await getDiscoveryJob(activeJobIdRef.current);
        setActiveJob(job);
        appendLines([
          makeLine({ kind: "system", text: formatStatusLine(job) }),
        ]);
        if (!isActiveJobStatus(job.status)) {
          await handleJobTerminal(job, true);
        }
        return;
      }
      const jobs = await listDiscoveryJobs();
      const latest = jobs[0];
      if (!latest) {
        appendLines([
          makeLine({ kind: "system", text: "[status] No discovery jobs yet." }),
        ]);
        return;
      }
      setActiveJob(latest);
      appendLines([
        makeLine({ kind: "system", text: formatStatusLine(latest) }),
      ]);
    } catch (error) {
      const message =
        error instanceof DiscoveryApiError
          ? error.message
          : "Status API unavailable.";
      appendLines([
        makeLine({
          kind: "warning",
          level: "warning",
          text: `[status] ${message}`,
        }),
      ]);
    }
  }, [appendLines, handleJobTerminal]);

  const runHistory = useCallback(async () => {
    try {
      const jobs = await listDiscoveryJobs();
      if (jobs.length === 0) {
        appendLines([
          makeLine({
            kind: "system",
            text: "[history] No recent jobs.",
          }),
        ]);
        return;
      }
      appendLines(
        jobs.slice(0, 20).map((job) =>
          makeLine({ kind: "system", text: formatHistoryLine(job) }),
        ),
      );
    } catch (error) {
      const message =
        error instanceof DiscoveryApiError
          ? error.message
          : "History API unavailable.";
      appendLines([
        makeLine({
          kind: "warning",
          level: "warning",
          text: `[history] ${message}`,
        }),
      ]);
    }
  }, [appendLines]);

  const runCancel = useCallback(async () => {
    const id = activeJobIdRef.current ?? activeJob?.id;
    if (!id) {
      appendLines([
        makeLine({
          kind: "system",
          text: "[cancel] No active discovery run.",
        }),
      ]);
      return;
    }
    try {
      const job = await cancelDiscoveryJob(id);
      setActiveJob(job);
      appendLines([
        makeLine({
          kind: "warning",
          level: "warning",
          text: "[cancel] Cancellation requested.",
        }),
      ]);
      if (!isActiveJobStatus(job.status)) {
        await handleJobTerminal(job, true);
      }
    } catch (error) {
      const message =
        error instanceof DiscoveryApiError
          ? error.message
          : "Could not cancel the run.";
      appendLines([
        makeLine({
          kind: "error",
          level: "error",
          text: `[cancel] ${message}`,
        }),
      ]);
    }
  }, [activeJob?.id, appendLines, handleJobTerminal]);

  const submit = useCallback(async () => {
    const raw = input;
    const parsed = parseTerminalCommand(raw);

    if (parsed.kind === "empty") return;

    if (parsed.kind !== "rejected" && parsed.kind !== "clear") {
      setHistory((prev) => {
        const next = [...prev.filter((h) => h !== raw.trim()), raw.trim()];
        return next.slice(-50);
      });
      setHistoryIndex(null);
    }

    if (parsed.kind === "rejected") {
      appendLines([
        makeLine({ kind: "prompt", text: raw.trim() }),
        makeLine({
          kind: "warning",
          level: "warning",
          text: parsed.message,
        }),
      ]);
      return;
    }

    if (parsed.kind === "help") {
      appendLines([
        makeLine({ kind: "prompt", text: raw.trim() || "/help" }),
        makeLine({
          kind: "help",
          text: TERMINAL_HELP_LINES.join("\n"),
        }),
      ]);
      setInput("");
      return;
    }

    if (parsed.kind === "clear") {
      setLines([]);
      setShowRunActions(false);
      setInput("");
      return;
    }

    if (parsed.kind === "find") {
      await startFind(parsed.request, raw);
      return;
    }

    appendLines([makeLine({ kind: "prompt", text: raw.trim() })]);
    setInput("");

    if (parsed.kind === "sources") {
      await runSources();
      return;
    }
    if (parsed.kind === "status") {
      await runStatus();
      return;
    }
    if (parsed.kind === "history") {
      await runHistory();
      return;
    }
    if (parsed.kind === "cancel") {
      await runCancel();
    }
  }, [
    appendLines,
    input,
    runCancel,
    runHistory,
    runSources,
    runStatus,
    startFind,
  ]);

  const onHistoryPrev = useCallback(() => {
    if (history.length === 0) return;
    setHistoryIndex((idx) => {
      if (idx === null) {
        setDraftBeforeHistory(input);
        const next = history.length - 1;
        setInput(history[next] ?? "");
        return next;
      }
      const next = Math.max(0, idx - 1);
      setInput(history[next] ?? "");
      return next;
    });
  }, [history, input]);

  const onHistoryNext = useCallback(() => {
    if (historyIndex === null) return;
    if (historyIndex >= history.length - 1) {
      setHistoryIndex(null);
      setInput(draftBeforeHistory);
      return;
    }
    const next = historyIndex + 1;
    setHistoryIndex(next);
    setInput(history[next] ?? "");
  }, [draftBeforeHistory, history, historyIndex]);

  const onRunAgain = useCallback(() => {
    const cmd = lastCommand ?? lastCompletedJob?.command;
    if (!cmd) return;
    setInput(cmd);
    void startFind(cmd, cmd);
  }, [lastCommand, lastCompletedJob?.command, startFind]);

  // Deep-link / reconnect to a job from ?job=
  useEffect(() => {
    if (!focusJobId) return;
    let cancelled = false;
    void (async () => {
      try {
        const job = await getDiscoveryJob(focusJobId);
        if (cancelled) return;
        setActiveJob(job);
        setLastCommand(job.command);
        appendLines([
          makeLine({
            kind: "system",
            text: `[view] ${formatStatusLine(job)}`,
          }),
        ]);
        if (isActiveJobStatus(job.status)) {
          lastSequenceRef.current = 0;
          seenEventIdsRef.current = new Set();
          attachStream(job.id);
        } else {
          setLastCompletedJob(job);
          setShowRunActions(true);
          if (job.status === "completed") {
            appendLines([
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
          appendLines([
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

  const live = Boolean(activeJob && isActiveJobStatus(activeJob.status));

  return (
    <div className="mx-auto flex w-full max-w-[90rem] flex-1 flex-col gap-3 lg:gap-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <TechnicalLabel>Ops · Discovery</TechnicalLabel>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Terminal
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Controlled discovery console — not a system shell.
          </p>
        </div>
        {live ? (
          <span className="border border-[color-mix(in_oklab,var(--accent-warn)_50%,transparent)] px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[color-mix(in_oklab,var(--accent-warn)_90%,white)]">
            Running
          </span>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:items-stretch">
        <BlueprintPanel
          className="flex min-h-[min(70dvh,40rem)] flex-1 flex-col overflow-hidden p-0 lg:min-h-[min(78dvh,48rem)]"
          corners
        >
          <div className="hidden items-center justify-between border-b border-[color-mix(in_oklab,var(--ink-line)_65%,transparent)] bg-surface/80 px-3 py-2 sm:flex">
            <TechnicalLabel className="mb-0">
              discovery · operator console
            </TechnicalLabel>
            <span className="font-mono text-[11px] text-muted">
              {activeJob
                ? `${activeJob.status} · ${activeJob.id.slice(0, 8)}`
                : "idle"}
            </span>
          </div>

          <TerminalOutput lines={lines} live={live} />
          <TerminalRunActions
            visible={showRunActions}
            jobId={lastCompletedJob?.id ?? activeJob?.id ?? null}
            onRunAgain={onRunAgain}
          />
          <TerminalInput
            value={input}
            onChange={setInput}
            onSubmit={() => void submit()}
            onHistoryPrev={onHistoryPrev}
            onHistoryNext={onHistoryNext}
            disabled={false}
            busy={submitting}
          />
        </BlueprintPanel>

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
