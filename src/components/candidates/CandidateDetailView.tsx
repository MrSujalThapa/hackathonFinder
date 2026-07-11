"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CandidateDetail } from "@/core/candidates/types";
import {
  CandidatesApiError,
  decideCandidate,
  fetchCandidate,
  type DecisionAction,
} from "@/lib/api/candidates";
import {
  formatDate,
  formatDateRange,
  formatLocation,
  formatMode,
} from "@/lib/candidates/format";
import { CandidateEvidenceLinks } from "@/components/candidates/CandidateEvidenceLinks";
import { CandidateScore } from "@/components/candidates/CandidateScore";
import { CandidateTags } from "@/components/candidates/CandidateTags";
import { PageHeader } from "@/components/shell/PageHeader";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";

export function CandidateDetailView({ id }: { id: string }) {
  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await fetchCandidate(id);
      setCandidate(detail);
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

  const apply = async (action: DecisionAction) => {
    if (!candidate) return;
    setBusy(true);
    try {
      const updated = await decideCandidate(candidate.id, action);
      setCandidate((prev) => (prev ? { ...prev, ...updated } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState label="Loading candidate…" />;
  if (error && !candidate) {
    return <ErrorState message={error} onRetry={() => void load()} />;
  }
  if (!candidate) return null;

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
