"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CandidateProgress } from "@/components/candidates/CandidateProgress";
import { SwipeDeck } from "@/components/queue/SwipeDeck";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { useCandidateQueue } from "@/hooks/useCandidateQueue";
import { formatSourceLabel } from "@/lib/candidates/format";

export function QueueReview() {
  const queue = useCandidateQueue();
  const router = useRouter();
  const [sourceFilter, setSourceFilter] = useState("");

  const sources = useMemo(() => {
    return [...new Set(queue.candidates.map((c) => c.source))].sort();
  }, [queue.candidates]);

  const filtered = useMemo(() => {
    if (!sourceFilter) return queue.candidates;
    return queue.candidates.filter((c) => c.source === sourceFilter);
  }, [queue.candidates, sourceFilter]);

  const visibleCurrent = filtered[0] ?? null;
  const visibleUpcoming = filtered[1] ?? null;

  // Prefetch next 2–3 candidate detail routes for snappy opens.
  useEffect(() => {
    for (const card of filtered.slice(0, 3)) {
      router.prefetch(`/candidate/${card.id}`);
    }
  }, [filtered, router]);

  return (
    <section className="hf-review-workspace flex flex-1 flex-col">
      <div className="w-full">
        <PageHeader
          eyebrow="Review"
          title="Queue"
          actions={
            <div className="flex items-center gap-2">
              <details className="relative">
                <summary
                  className="hf-btn hf-btn-ghost hf-touch cursor-pointer list-none px-2"
                  aria-label="Keyboard shortcuts help"
                >
                  ?
                </summary>
                <div className="absolute right-0 z-20 mt-2 w-64 rounded-[var(--radius-lg)] border border-border bg-elevated p-3 text-xs text-muted shadow-[var(--shadow-soft)]">
                  <p className="mb-1 font-medium text-foreground">Shortcuts</p>
                  <ul className="space-y-1">
                    <li>Left arrow — reject</li>
                    <li>Right arrow — approve</li>
                    <li>S — save</li>
                    <li>Enter — open details</li>
                    <li>Escape — close actions menu</li>
                  </ul>
                </div>
              </details>
              <button
                type="button"
                onClick={() => void queue.refresh()}
                className="hf-btn hf-btn-ghost"
              >
                Refresh
              </button>
            </div>
          }
        />

        {sources.length > 1 ? (
          <label className="mb-4 block text-sm">
            <span className="sr-only">Filter by source</span>
            <select
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
              className="hf-input"
            >
              <option value="">All sources</option>
              {sources.map((source) => (
                <option key={source} value={source}>
                  {formatSourceLabel(source)}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {queue.loading && !visibleCurrent ? (
          <LoadingState label="Loading queue…" />
        ) : null}

        {!queue.loading && queue.error && !visibleCurrent ? (
          <ErrorState
            message={queue.error}
            onRetry={() => void queue.refresh()}
          />
        ) : null}

        {!queue.loading && !queue.error && !visibleCurrent ? (
          <EmptyState
            title="No new hackathons to review"
            description="Run the agent to discover more, then refresh this queue. In mock mode you can also reset the in-memory fixtures."
            hint={'npm run agent -- "find upcoming hackathons" -- --sources=hacklist'}
            action={
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    await fetch("/api/dev/reset-mock", { method: "POST" });
                    queue.clearSeenIds();
                    await queue.refresh();
                  })();
                }}
                className="rounded-xl border border-sky-500/40 px-3 py-2 text-sm text-sky-200 hover:bg-sky-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
              >
                Reset mock candidates
              </button>
            }
          />
        ) : null}

        {visibleCurrent ? (
          <>
            <CandidateProgress
              current={Math.max(1, queue.position)}
              total={queue.total}
            />
            {queue.loadingMore ? (
              <p
                className="mb-3 text-center text-xs text-muted"
                role="status"
                aria-live="polite"
              >
                Loading more candidates...
              </p>
            ) : null}
            {queue.syncMessage ? (
              <p
                className="mb-3 text-center text-xs text-sky-100/90"
                role="status"
                aria-live="polite"
              >
                {queue.syncMessage}
                <button
                  type="button"
                  className="ml-2 underline"
                  onClick={queue.clearSyncMessage}
                >
                  dismiss
                </button>
              </p>
            ) : null}
            {queue.error ? (
              <p
                className="mb-3 text-center text-xs text-amber-200/90"
                role="alert"
                aria-live="assertive"
              >
                {queue.error}
                <button
                  type="button"
                  className="ml-2 underline"
                  onClick={queue.clearError}
                >
                  dismiss
                </button>
              </p>
            ) : null}
            <SwipeDeck
              key={visibleCurrent.id}
              candidate={visibleCurrent}
              upcoming={visibleUpcoming}
              busy={queue.isPending(visibleCurrent.id)}
              onDecision={queue.decide}
            />
          </>
        ) : null}
      </div>
    </section>
  );
}
