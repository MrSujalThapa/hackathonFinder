type ErrorStateProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
};

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      className="flex w-full max-w-md flex-col items-center rounded-2xl border border-red-500/30 bg-red-950/20 px-6 py-10 text-center"
      role="alert"
    >
      <h2 className="text-lg font-semibold tracking-tight text-red-100">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-red-100/70">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-2 text-sm text-red-100 transition-colors hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/60"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
