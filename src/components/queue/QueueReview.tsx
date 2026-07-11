"use client";

import { useMemo, useState } from "react";
import { CandidateProgress } from "@/components/candidates/CandidateProgress";
import { SwipeDeck } from "@/components/queue/SwipeDeck";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { useCandidateQueue } from "@/hooks/useCandidateQueue";

export function QueueReview() {
  const queue = useCandidateQueue();
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

  return (
    <section className="flex flex-1 flex-col items-center">
      <div className="w-full max-w-[440px]">
        <PageHeader
          eyebrow="Review"
          title="Queue"
          description="One candidate at a time. Approve, reject, or save for later."
          actions={
            <button
              type="button"
              onClick={() => void queue.refresh()}
              className="rounded-xl border border-border px-3 py-2 text-sm text-muted transition-colors hover:border-sky-500/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
            >
              Refresh
            </button>
          }
        />

        {sources.length > 1 ? (
          <label className="mb-4 block text-sm">
            <span className="sr-only">Filter by source</span>
            <select
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
              className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
            >
              <option value="">All sources</option>
              {sources.map((source) => (
                <option key={source} value={source}>
                  {source}
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
                    sessionStorage.removeItem("hackathon-radar-queue-seen");
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
              current={Math.max(1, queue.total - filtered.length + 1)}
              total={queue.total}
            />
            {queue.syncMessage ? (
              <p
                className="mb-3 text-center text-xs text-sky-100/90"
                role="status"
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
              <p className="mb-3 text-center text-xs text-amber-200/90" role="status">
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
              busy={queue.busy}
              onDecision={queue.decide}
            />
          </>
        ) : null}
      </div>
    </section>
  );
}
