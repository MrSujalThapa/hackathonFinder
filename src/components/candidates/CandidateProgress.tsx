import { QueueCounter } from "@/components/ui/QueueCounter";

export function CandidateProgress({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  const pct = total > 0 ? Math.min(100, (current / total) * 100) : 0;

  return (
    <div className="mb-4 w-full max-w-[420px]">
      <div className="mb-2 flex items-center justify-between">
        <QueueCounter current={current} total={total} />
        <span className="text-[11px] text-muted">Swipe or use buttons</span>
      </div>
      <div
        className="h-1 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={total}
      >
        <div
          className="h-full rounded-full bg-sky-400/70 transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
