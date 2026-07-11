"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CandidateCard } from "@/core/candidates/types";
import type { CandidateStatus } from "@/lib/supabase/database.types";
import {
  CandidatesApiError,
  decideCandidate,
  fetchCandidates,
  syncCandidateSheet,
} from "@/lib/api/candidates";
import {
  getBucket,
  insertIntoQueue,
  replaceBucket,
  subscribe,
  type HistoryBucket,
} from "@/lib/candidates/clientStore";
import { unseeCandidate } from "@/lib/candidates/queueSeen";
import { formatDateRange, formatLocation, formatSourceLabel } from "@/lib/candidates/format";
import { timedAsync } from "@/lib/perf/timing";
import {
  needsSheetRetry,
  SheetSyncBadge,
} from "@/components/sheets/SheetSyncBadge";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";

const STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  NEEDS_REVIEW: "Needs review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SAVED_FOR_LATER: "Saved",
  EXPIRED: "Expired",
};

type HistoryViewProps = {
  status: CandidateStatus;
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  allowRestore?: boolean;
};

function asHistoryBucket(status: CandidateStatus): HistoryBucket | null {
  if (
    status === "APPROVED" ||
    status === "REJECTED" ||
    status === "SAVED_FOR_LATER"
  ) {
    return status;
  }
  return null;
}

export function HistoryView({
  status,
  title,
  description,
  emptyTitle,
  emptyDescription,
  allowRestore = false,
}: HistoryViewProps) {
  const [candidates, setCandidates] = useState<CandidateCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failedSyncIds, setFailedSyncIds] = useState<Set<string>>(
    () => new Set(),
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await timedAsync("history.fetch", () =>
        fetchCandidates({
          status,
          limit: 50,
          sort: "found_at",
          source: source || undefined,
          q: query.trim() || undefined,
        }),
      );
      setCandidates(result.candidates);
      const bucket = asHistoryBucket(status);
      if (bucket && !source && !query.trim()) {
        replaceBucket(bucket, result.candidates);
      }
    } catch (err) {
      setError(
        err instanceof CandidatesApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load candidates",
      );
    } finally {
      setLoading(false);
    }
  }, [status, source, query]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void load();
    }, 200);
    return () => window.clearTimeout(handle);
  }, [load]);

  useEffect(() => {
    return subscribe(() => {
      const bucket = asHistoryBucket(status);
      if (!bucket) return;
      if (source || query.trim()) return;

      const storeCards = getBucket(status);
      setCandidates((prev) => {
        const storeIds = new Set(storeCards.map((item) => item.id));
        const prevIds = new Set(prev.map((item) => item.id));
        const same =
          storeCards.length === prev.length &&
          storeCards.every((card) => prevIds.has(card.id)) &&
          prev.every((card) => storeIds.has(card.id));
        if (same) {
          // Merge field updates for shared ids
          const byId = new Map(storeCards.map((card) => [card.id, card]));
          return prev.map((card) => byId.get(card.id) ?? card);
        }
        return storeCards;
      });
    });
  }, [status, source, query]);

  const sources = useMemo(() => {
    return [...new Set(candidates.map((c) => c.source))].sort();
  }, [candidates]);

  const restore = async (id: string) => {
    const existing = candidates.find((item) => item.id === id);
    if (!existing) return;
    setBusyId(id);
    try {
      const previousStatus = existing.status;
      const { candidate: updated } = await decideCandidate(id, "restore");
      unseeCandidate(id);
      insertIntoQueue(updated);
      setCandidates((prev) => prev.filter((item) => item.id !== id));

      if (previousStatus === "APPROVED") {
        void syncCandidateSheet(id).catch(() => {
          // Reconcile is best-effort until sync-sheet supports non-APPROVED.
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setBusyId(null);
    }
  };

  const retrySync = async (id: string) => {
    setBusyId(id);
    try {
      const result = await syncCandidateSheet(id);
      if (result.sheetSync.status === "failed") {
        setFailedSyncIds((prev) => new Set(prev).add(id));
        setError(result.sheetSync.message ?? "Sheet sync failed");
      } else {
        setFailedSyncIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
      if (result.candidate) {
        setCandidates((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  ...result.candidate,
                }
              : item,
          ),
        );
      }
    } catch (err) {
      setFailedSyncIds((prev) => new Set(prev).add(id));
      setError(err instanceof Error ? err.message : "Sheet sync failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section>
      <PageHeader
        eyebrow="History"
        title={title}
        description={description}
        actions={
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl border border-border px-3 py-2 text-sm text-muted transition-colors hover:border-sky-500/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
          >
            Refresh
          </button>
        }
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <label className="flex-1 text-sm">
          <span className="sr-only">Search by name</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name"
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
          />
        </label>
        <label className="sm:w-44 text-sm">
          <span className="sr-only">Filter by source</span>
          <select
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
          >
            <option value="">All sources</option>
            {sources.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && candidates.length === 0 ? (
        <LoadingState label="Loading history…" />
      ) : null}
      {!loading && error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : null}
      {!loading && !error && candidates.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : null}

      {candidates.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {candidates.map((candidate) => {
            const lastSyncFailed = failedSyncIds.has(candidate.id);
            const showRetry =
              !allowRestore &&
              candidate.status === "APPROVED" &&
              needsSheetRetry({
                sheetRowId: candidate.sheetRowId,
                lastSyncFailed,
              });

            return (
              <li
                key={candidate.id}
                className="rounded-2xl border border-border bg-card/80 p-4 transition-colors hover:border-sky-500/30"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <Link
                    href={`/candidate/${candidate.id}`}
                    className="text-base font-semibold tracking-tight hover:text-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
                  >
                    {candidate.name}
                  </Link>
                  <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted">
                    {STATUS_LABEL[candidate.status] ?? candidate.status}
                  </span>
                </div>
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                  {formatLocation(candidate)}
                </p>
                <p className="mt-2 text-sm text-foreground/75">
                  {formatDateRange(candidate.startDate, candidate.endDate)}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Source · {formatSourceLabel(candidate.source)}
                </p>
                {candidate.status === "APPROVED" ? (
                  <div className="mt-3">
                    <SheetSyncBadge
                      sheetRowId={candidate.sheetRowId}
                      sheetAppendedAt={candidate.sheetAppendedAt}
                      lastSyncFailed={lastSyncFailed}
                    />
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href={`/candidate/${candidate.id}`}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
                  >
                    Open
                  </Link>
                  {allowRestore ? (
                    <button
                      type="button"
                      disabled={busyId === candidate.id}
                      onClick={() => void restore(candidate.id)}
                      className="rounded-lg border border-sky-500/40 px-2.5 py-1.5 text-xs text-sky-200 transition-colors hover:bg-sky-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 disabled:opacity-40"
                    >
                      Restore to queue
                    </button>
                  ) : null}
                  {showRetry ? (
                    <button
                      type="button"
                      disabled={busyId === candidate.id}
                      onClick={() => void retrySync(candidate.id)}
                      className="rounded-lg border border-amber-500/40 px-2.5 py-1.5 text-xs text-amber-100 transition-colors hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60 disabled:opacity-40"
                    >
                      Retry Sync
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
