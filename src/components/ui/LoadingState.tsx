export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div
      className="flex w-full max-w-md flex-col items-center justify-center gap-3 py-16"
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-sky-400" />
      <p className="text-sm text-muted">{label}</p>
      <div className="mt-2 w-full max-w-xs space-y-2" aria-hidden>
        <div className="h-3 rounded-full bg-white/10" />
        <div className="h-3 w-5/6 rounded-full bg-white/10" />
        <div className="h-3 w-2/3 rounded-full bg-white/10" />
      </div>
    </div>
  );
}
