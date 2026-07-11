import { scoreTone } from "@/lib/candidates/format";

export function CandidateScore({ score }: { score: number }) {
  return (
    <div
      className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl border border-border bg-black/30"
      aria-label={`Score ${score}`}
    >
      <span className={`text-sm font-semibold tabular-nums ${scoreTone(score)}`}>
        {Math.round(score)}
      </span>
      <span className="text-[9px] uppercase tracking-wider text-muted">score</span>
    </div>
  );
}
