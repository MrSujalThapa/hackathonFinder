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
      className="flex w-full max-w-md flex-col items-center rounded-[var(--radius-xl)] border border-[color-mix(in_oklab,var(--accent-danger)_30%,transparent)] bg-[color-mix(in_oklab,var(--accent-danger)_8%,transparent)] px-6 py-10 text-center"
      role="alert"
    >
      <h2 className="text-lg font-semibold tracking-tight text-red-100">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-red-100/70">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="hf-btn mt-5 border-[color-mix(in_oklab,var(--accent-danger)_40%,transparent)] text-red-100 hover:bg-[color-mix(in_oklab,var(--accent-danger)_12%,transparent)]"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
