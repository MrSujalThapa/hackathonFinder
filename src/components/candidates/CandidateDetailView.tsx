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
import {
  getCandidateActions,
  type CandidateActionDef,
} from "@/lib/candidates/actionPolicy";
import {
  getDetailDescription,
  getQueueSummary,
} from "@/lib/candidates/displayContent";
import { AskComposer } from "@/components/candidates/ask";
import { CandidateEvidenceLinks } from "@/components/candidates/CandidateEvidenceLinks";
import { CandidateEvidencePanel } from "@/components/candidates/CandidateEvidencePanel";
import { CandidateActionHistory } from "@/components/candidates/CandidateActionHistory";
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

function actionButtonClass(action: CandidateActionDef, fullWidth = false): string {
  const toneClass =
    action.tone === "approve"
      ? "hf-btn-approve"
      : action.tone === "reject"
        ? "hf-btn-reject"
        : action.tone === "save"
          ? "hf-btn-save"
          : "hf-btn-ghost";
  return [
    "hf-btn",
    toneClass,
    "hf-touch",
    fullWidth ? "w-full" : "",
    action.priority === "secondary" ? "text-sm" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

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
    if (!candidate || !trimmed || askLoading) return;
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
  const detailParagraphs = getDetailDescription(candidate);
  const headerSummary = getQueueSummary(candidate);
  const actions = getCandidateActions(candidate);

  const renderActionButtons = (fullWidth = false) =>
    actions.map((action) => (
      <button
        key={action.id}
        type="button"
        disabled={busy}
        onClick={() => void apply(action.apiAction)}
        className={actionButtonClass(action, fullWidth)}
      >
        {action.label}
      </button>
    ));

  return (
    <section className="mx-auto w-full max-w-[calc(var(--content-detail)+var(--content-rail)+2rem)]">
      <PageHeader
        eyebrow="Candidate"
        title={candidate.name}
        description={headerSummary}
        titleClassName="hf-doc-title"
        actions={
          <Link href="/queue" className="hf-btn hf-btn-ghost hf-touch">
            Back to queue
          </Link>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,var(--content-detail))_var(--content-rail)] xl:items-start">
      <div className="space-y-5 border border-border bg-card p-5 sm:space-y-6 sm:p-6 rounded-[var(--radius-xl)]">
        <div className="flex items-start justify-between gap-3 xl:hidden">
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

        <div className="xl:hidden">
          <CandidateTags themes={candidate.themes} />
        </div>

        {candidate.status === "NEEDS_REVIEW" ? (
          <section className="rounded-[var(--radius-xl)] border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            <h2 className="hf-section-label text-amber-200/90">Needs review</h2>
            <p className="mt-1 text-amber-100/85">
              This candidate was not confident enough for normal scoring. Check
              official/apply links and evidence before approving.
            </p>
          </section>
        ) : null}

        {candidate.status === "APPROVED" ? (
          <section className="hf-panel px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="hf-section-label">Google Sheet</h2>
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
                className="hf-btn mt-3 border-amber-500/40 text-amber-100 hover:bg-amber-500/10"
              >
                Retry Sync
              </button>
            ) : null}
          </section>
        ) : null}

        {detailParagraphs.length > 0 ? (
          <div className="space-y-3 text-sm leading-relaxed text-foreground/80">
            {detailParagraphs.map((paragraph) => (
              <p key={paragraph.slice(0, 48)}>{paragraph}</p>
            ))}
          </div>
        ) : null}

        {candidate.whyMatch.length > 0 ? (
          <section>
            <h2 className="hf-section-label">Why it matches</h2>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
              {candidate.whyMatch.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {candidate.redFlags.length > 0 ? (
          <section>
            <h2 className="hf-section-label text-amber-300/80">Red flags</h2>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-amber-100/80">
              {candidate.redFlags.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <CandidateEvidenceLinks candidate={candidate} />

        <CandidateEvidencePanel evidence={candidate.evidence} />

        <AskComposer
          question={question}
          onQuestionChange={setQuestion}
          onSubmit={(value) => void submitQuestion(value)}
          loading={askLoading}
          error={askError}
          answers={candidate.answers}
        />

        <CandidateActionHistory actions={candidate.actions} />

        <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-4 xl:hidden">
          {renderActionButtons(false)}
        </div>
      </div>

      <aside className="hidden space-y-3 xl:block">
        <div className="hf-panel space-y-2 px-4 py-3 text-sm">
          <p className="hf-section-label">Facts</p>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
            {formatLocation(candidate)} · {formatMode(candidate.mode)}
          </p>
          <p>{formatDateRange(candidate.startDate, candidate.endDate)}</p>
          <p className="text-muted">
            Deadline{" "}
            {candidate.deadline ? formatDate(candidate.deadline) : "unclear"}
          </p>
          <div className="pt-2">
            <CandidateScore score={candidate.score} />
          </div>
          <CandidateTags themes={candidate.themes} />
        </div>
        <div className="hf-panel space-y-2 px-4 py-3">
          <p className="hf-section-label">Actions</p>
          <div className="grid gap-2">{renderActionButtons(true)}</div>
        </div>
      </aside>
      </div>
    </section>
  );
}
