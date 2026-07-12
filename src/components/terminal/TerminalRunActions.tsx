"use client";

type TerminalRunActionsProps = {
  jobId: string | null;
  onRunAgain: () => void;
  visible: boolean;
};

/** Post-run actions — plain anchors for reliable mobile + testability. */
export function TerminalRunActions({
  jobId,
  onRunAgain,
  visible,
}: TerminalRunActionsProps) {
  if (!visible) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-t border-[color-mix(in_oklab,var(--ink-line)_55%,transparent)] px-3 py-2 sm:px-4"
      role="group"
      aria-label="After run actions"
    >
      <a
        href="/queue"
        className="hf-focus inline-flex min-h-[44px] items-center border border-border px-3 font-mono text-xs text-muted transition-colors hover:border-[color-mix(in_oklab,var(--accent-save)_45%,transparent)] hover:text-foreground"
      >
        Open queue
      </a>
      {jobId ? (
        <a
          href={`/terminal?job=${encodeURIComponent(jobId)}`}
          className="hf-focus inline-flex min-h-[44px] items-center border border-border px-3 font-mono text-xs text-muted transition-colors hover:border-[color-mix(in_oklab,var(--accent-save)_45%,transparent)] hover:text-foreground"
        >
          View run
        </a>
      ) : null}
      <button
        type="button"
        onClick={onRunAgain}
        className="hf-focus inline-flex min-h-[44px] items-center border border-border px-3 font-mono text-xs text-muted transition-colors hover:border-[color-mix(in_oklab,var(--accent-save)_45%,transparent)] hover:text-foreground"
      >
        Run again
      </button>
    </div>
  );
}
