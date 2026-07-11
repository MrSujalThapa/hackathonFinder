"use client";

type CandidateActionsProps = {
  onApprove: () => void;
  onReject: () => void;
  onSave: () => void;
  disabled?: boolean;
};

const baseBtn =
  "flex h-14 w-14 items-center justify-center rounded-full border text-lg transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40 active:scale-95";

export function CandidateActions({
  onApprove,
  onReject,
  onSave,
  disabled = false,
}: CandidateActionsProps) {
  return (
    <div
      className="flex items-center justify-center gap-5"
      role="group"
      aria-label="Candidate actions"
    >
      <button
        type="button"
        aria-label="Reject"
        disabled={disabled}
        onClick={onReject}
        className={`${baseBtn} border-slate-500/50 bg-slate-500/10 text-slate-200 hover:bg-slate-500/20 focus-visible:ring-slate-300`}
      >
        ✕
      </button>
      <button
        type="button"
        aria-label="Save for later"
        disabled={disabled}
        onClick={onSave}
        className={`${baseBtn} h-12 w-12 border-sky-500/40 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20 focus-visible:ring-sky-300`}
      >
        ◇
      </button>
      <button
        type="button"
        aria-label="Approve"
        disabled={disabled}
        onClick={onApprove}
        className={`${baseBtn} border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 focus-visible:ring-emerald-300`}
      >
        ✓
      </button>
    </div>
  );
}
