"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CandidateDetail } from "@/core/candidates/types";
import {
  CandidatesApiError,
  askCandidate,
  decideCandidate,
  fetchCandidate,
  syncCandidateSheet,
  type DecisionAction,
} from "@/lib/api/candidates";
import {
  applyStatusChange,
  getDetail,
  insertIntoQueue,
  setDetail,
  subscribe,
} from "@/lib/candidates/clientStore";
import { unseeCandidate } from "@/lib/candidates/queueSeen";
import {
  formatDate,
  formatDateRange,
  formatLocation,
  formatMode,
} from "@/lib/candidates/format";
import { CandidateEvidenceLinks } from "@/components/candidates/CandidateEvidenceLinks";
import { CandidateScore } from "@/components/candidates/CandidateScore";
import { CandidateTags } from "@/components/candidates/CandidateTags";
import {
  needsSheetRetry,
  SheetSyncBadge,
} from "@/components/sheets/SheetSyncBadge";
import { PageHeader } from "@/components/shell/PageHeader";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { messageForSheetSync } from "@/hooks/useCandidateQueue";

export function CandidateDetailView({ id }: { id: string }) {
  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastSyncFailed, setLastSyncFailed] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await fetchCandidate(id);
      setCandidate(detail);
      setDetail(detail);
    } catch (err) {
      setError(
        err instanceof CandidatesApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load candidate",
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return subscribe(() => {
      const fromStore = getDetail(id);
      if (!fromStore) return;
      setCandidate((prev) => {
        if (!prev) return prev;
        if (prev.status === fromStore.status && prev.id === fromStore.id) {
          return { ...prev, ...fromStore };
        }
        return { ...prev, ...fromStore };
      });
    });
  }, [id]);

  const apply = async (action: DecisionAction) => {
    if (!candidate) return;
    setBusy(true);
    setSyncNote(null);
    const previousStatus = candidate.status;
    try {
      const { candidate: updated } = await decideCandidate(
        candidate.id,
        action,
      );
      applyStatusChange({
        id: candidate.id,
        previousStatus,
        newStatus: updated.status,
        card: updated,
      });
      setCandidate((prev) => (prev ? { ...prev, ...updated } : prev));
      setDetail({ ...candidate, ...updated });

      if (action === "restore") {
        unseeCandidate(candidate.id);
        insertIntoQueue(updated);
      }

      setBusy(false);

      if (action === "approve") {
        void syncCandidateSheet(candidate.id)
          .then(async (result) => {
            if (result.sheetSync.status === "failed") {
              setLastSyncFailed(true);
              setSyncNote(
                messageForSheetSync(result.sheetSync) ??
                  "Approved; Sheet sync failed — retry below.",
              );
            } else {
              setLastSyncFailed(false);
              setSyncNote(messageForSheetSync(result.sheetSync));
              if (result.candidate) {
                setCandidate((prev) =>
                  prev ? { ...prev, ...result.candidate } : prev,
                );
              } else {
                const detail = await fetchCandidate(candidate.id);
                setCandidate(detail);
                setDetail(detail);
              }
            }
          })
          .catch((err: unknown) => {
            setLastSyncFailed(true);
            setSyncNote(
              err instanceof Error
                ? `Approved; Sheet sync failed — ${err.message}`
                : "Approved; Sheet sync failed — retry below.",
            );
          });
      } else if (previousStatus === "APPROVED") {
        void syncCandidateSheet(candidate.id)
          .then(({ sheetSync }) => {
            if (sheetSync.status === "failed") {
              setLastSyncFailed(true);
              setSyncNote(
                sheetSync.message ??
                  "Status updated; Sheet cleanup failed — retry below.",
              );
            }
          })
          .catch((err: unknown) => {
            setLastSyncFailed(true);
            setSyncNote(
              err instanceof Error
                ? err.message
                : "Status updated; Sheet cleanup failed — retry below.",
            );
          });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
      setBusy(false);
    }
  };

  const retrySync = async () => {
    if (!candidate) return;
    setBusy(true);
    setSyncNote(null);
    try {
      const result = await syncCandidateSheet(candidate.id);
      if (result.sheetSync.status === "failed") {
        setLastSyncFailed(true);
        setSyncNote(result.sheetSync.message ?? "Sheet sync failed");
      } else {
        setLastSyncFailed(false);
        if (result.sheetSync.status === "mock_synced") {
          setSyncNote("Mock Sheet sync — not written to Google.");
        } else {
          setSyncNote(messageForSheetSync(result.sheetSync));
        }
      }
      if (result.candidate) {
        setCandidate((prev) =>
          prev ? { ...prev, ...result.candidate } : prev,
        );
      } else {
        const detail = await fetchCandidate(candidate.id);
        setCandidate(detail);
      }
    } catch (err) {
      setLastSyncFailed(true);
      setSyncNote(err instanceof Error ? err.message : "Sheet sync failed");
    } finally {
      setBusy(false);
    }
  };

  const submitQuestion = async (value: string) => {
    const trimmed = value.trim();
    if (!candidate || !trimmed) return;
    setAskLoading(true);
    setAskError(null);
    const controller = new AbortController();
    try {
      const result = await askCandidate(candidate.id, trimmed, controller.signal);
      setCandidate(result.updatedCandidate);
      setDetail(result.updatedCandidate);
      setQuestion("");
    } catch (err) {
      setAskError(err instanceof Error ? err.message : "Question failed");
    } finally {
      setAskLoading(false);
    }
  };

  if (loading) return <LoadingState label="Loading candidate…" />;
  if (error && !candidate) {
    return <ErrorState message={error} onRetry={() => void load()} />;
  }
  if (!candidate) return null;

  const isMockSheetRow =
    candidate.sheetRowId != null &&
    (candidate.sheetRowId.startsWith("mock:") ||
      candidate.sheetRowId.startsWith("mock-row:"));
  const showRetry =
    candidate.status === "APPROVED" &&
    needsSheetRetry({
      sheetRowId: candidate.sheetRowId,
      lastSyncFailed,
    });

  return (
    <section className="mx-auto w-full max-w-2xl">
      <PageHeader
        eyebrow="Candidate"
        title={candidate.name}
        description={candidate.summary ?? "No summary available."}
        actions={
          <Link
            href="/queue"
            className="rounded-xl border border-border px-3 py-2 text-sm text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
          >
            Back to queue
          </Link>
        }
      />

      <div className="space-y-5 rounded-3xl border border-border bg-card/80 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
              {formatLocation(candidate)} · {formatMode(candidate.mode)}
            </p>
            <p className="mt-2 text-sm text-foreground/80">
              {formatDateRange(candidate.startDate, candidate.endDate)}
            </p>
            <p className="mt-1 text-sm text-muted">
              Deadline{" "}
              {candidate.deadline ? formatDate(candidate.deadline) : "unclear"}
            </p>
          </div>
          <CandidateScore score={candidate.score} />
        </div>

        <CandidateTags themes={candidate.themes} />

        {candidate.status === "APPROVED" ? (
          <section className="rounded-2xl border border-border/70 bg-black/20 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                Google Sheet
              </h2>
              <SheetSyncBadge
                sheetRowId={candidate.sheetRowId}
                sheetAppendedAt={candidate.sheetAppendedAt}
                lastSyncFailed={lastSyncFailed}
              />
            </div>
            <dl className="mt-3 space-y-1 text-sm text-foreground/80">
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted">Row</dt>
                <dd className="font-mono text-xs">
                  {candidate.sheetRowId ?? "—"}
                  {isMockSheetRow ? (
                    <span className="ml-2 text-amber-100/85">
                      (mock — not written to Google)
                    </span>
                  ) : null}
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted">Synced at</dt>
                <dd>
                  {candidate.sheetAppendedAt
                    ? new Date(candidate.sheetAppendedAt).toLocaleString()
                    : "—"}
                </dd>
              </div>
            </dl>
            {syncNote ? (
              <p className="mt-2 text-xs text-amber-100/90" role="status">
                {syncNote}
              </p>
            ) : null}
            {showRetry ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void retrySync()}
                className="mt-3 rounded-xl border border-amber-500/40 px-3 py-2 text-sm text-amber-100 hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60 disabled:opacity-40"
              >
                Retry Sync
              </button>
            ) : null}
          </section>
        ) : null}

        {candidate.description ? (
          <p className="text-sm leading-relaxed text-foreground/80">
            {candidate.description}
          </p>
        ) : null}

        {candidate.whyMatch.length > 0 ? (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Why it matches
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
              {candidate.whyMatch.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {candidate.redFlags.length > 0 ? (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-300/80">
              Red flags
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-amber-100/80">
              {candidate.redFlags.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <CandidateEvidenceLinks candidate={candidate} />

        <section className="rounded-2xl border border-border/70 bg-black/20 px-4 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Ask
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              "Deadline?",
              "Remote?",
              "Prizes?",
              "Eligibility?",
              "Official application link?",
            ].map((item) => (
              <button
                key={item}
                type="button"
                disabled={askLoading}
                onClick={() => void submitQuestion(item)}
                className="rounded-xl border border-border px-3 py-2 text-xs text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 disabled:opacity-40"
              >
                {item}
              </button>
            ))}
          </div>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submitQuestion(question);
            }}
          >
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              disabled={askLoading}
              placeholder="Ask about deadline, remote, prizes..."
              className="min-w-0 flex-1 rounded-xl border border-border bg-black/30 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-sky-400/70"
            />
            <button
              type="submit"
              disabled={askLoading || !question.trim()}
              className="rounded-xl border border-sky-500/40 px-3 py-2 text-sm text-sky-200 hover:bg-sky-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 disabled:opacity-40"
            >
              {askLoading ? "Asking" : "Ask"}
            </button>
          </form>
          {askError ? (
            <p className="mt-2 text-xs text-amber-100/90" role="alert">
              {askError}
            </p>
          ) : null}
          {candidate.answers.length > 0 ? (
            <ul className="mt-4 space-y-3">
              {candidate.answers.map((answer) => {
                const sources = Array.isArray(answer.sources)
                  ? answer.sources as Array<{ url?: string; label?: string }>
                  : [];
                return (
                  <li key={answer.id} className="rounded-xl border border-border/60 bg-black/20 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{answer.question}</p>
                      <span className="text-[11px] uppercase tracking-wider text-muted">
                        {answer.confidence ?? "low"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-foreground/80">{answer.answer}</p>
                    {sources.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {sources
                          .filter((source) => source.url)
                          .map((source) => (
                            <a
                              key={`${answer.id}-${source.url}`}
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-sky-300 hover:underline"
                            >
                              {source.label ?? "Source"}
                            </a>
                          ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>

        {candidate.evidence.length > 0 ? (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Evidence
            </h2>
            <ul className="mt-2 space-y-2">
              {candidate.evidence.map((item) => (
                <li
                  key={item.id}
                  className="rounded-xl border border-border/70 bg-black/20 px-3 py-2 text-sm"
                >
                  <p className="text-xs uppercase tracking-wider text-muted">
                    {item.type}
                  </p>
                  <p className="mt-1">{item.title ?? item.snippet ?? "Evidence item"}</p>
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-sky-300 hover:underline"
                    >
                      Open source
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {candidate.actions.length > 0 ? (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Action history
            </h2>
            <ul className="mt-2 space-y-2">
              {candidate.actions.map((action) => (
                <li key={action.id} className="text-sm text-foreground/75">
                  <span className="font-medium text-foreground">
                    {action.action}
                  </span>
                  {action.previousStatus && action.newStatus
                    ? ` · ${action.previousStatus} → ${action.newStatus}`
                    : null}
                  <span className="ml-2 text-xs text-muted">
                    {new Date(action.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t border-border/70 pt-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply("approve")}
            className="rounded-xl border border-emerald-500/40 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60 disabled:opacity-40"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply("save")}
            className="rounded-xl border border-sky-500/40 px-3 py-2 text-sm text-sky-200 hover:bg-sky-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 disabled:opacity-40"
          >
            Save
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply("reject")}
            className="rounded-xl border border-slate-400/40 px-3 py-2 text-sm text-slate-200 hover:bg-slate-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/60 disabled:opacity-40"
          >
            Reject
          </button>
          {candidate.status !== "NEW" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void apply("restore")}
              className="rounded-xl border border-border px-3 py-2 text-sm text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 disabled:opacity-40"
            >
              Restore to queue
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
