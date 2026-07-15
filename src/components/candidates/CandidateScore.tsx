import { scoreTone } from "@/lib/candidates/format";

export function CandidateScore({ score }: { score: number }) {
  return (
    <div
      className="flex h-14 min-w-14 shrink-0 flex-col items-center justify-center rounded-2xl border border-border bg-black/30 px-1.5"
      aria-label={`Discovery relevance ${score}`}
    >
      <span className={`text-sm font-semibold tabular-nums ${scoreTone(score)}`}>
        {Math.round(score)}
      </span>
      <span className="mt-0.5 max-w-[4.5rem] text-center text-[8px] leading-tight uppercase tracking-wider text-muted">
        Discovery relevance
      </span>
    </div>
  );
}
