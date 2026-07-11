export function QueueCounter({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  if (total <= 0) {
    return (
      <p className="text-xs tabular-nums text-muted" aria-live="polite">
        Queue empty
      </p>
    );
  }

  return (
    <p className="text-xs tabular-nums text-muted" aria-live="polite">
      <span className="text-foreground/90">{current}</span> of {total}
    </p>
  );
}
