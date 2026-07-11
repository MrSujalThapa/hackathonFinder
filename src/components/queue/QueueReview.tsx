"use client";

import { CandidateProgress } from "@/components/candidates/CandidateProgress";
import { SwipeDeck } from "@/components/queue/SwipeDeck";
import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { useCandidateQueue } from "@/hooks/useCandidateQueue";

export function QueueReview() {
  const queue = useCandidateQueue();

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

        {queue.loading ? <LoadingState label="Loading queue…" /> : null}

        {!queue.loading && queue.error && !queue.current ? (
          <ErrorState
            message={queue.error}
            onRetry={() => void queue.refresh()}
          />
        ) : null}

        {!queue.loading && !queue.error && !queue.current ? (
          <EmptyState
            title="No new hackathons to review"
            description="Run the agent to discover more, then refresh this queue."
            hint={'npm run agent -- "find upcoming hackathons" -- --sources=hacklist'}
          />
        ) : null}

        {queue.current ? (
          <>
            <CandidateProgress
              current={queue.position}
              total={queue.total}
            />
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
              candidate={queue.current}
              upcoming={queue.upcoming}
              busy={queue.busy}
              onDecision={queue.decide}
            />
          </>
        ) : null}
      </div>
    </section>
  );
}
