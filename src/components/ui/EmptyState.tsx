type EmptyStateProps = {
  title: string;
  description: string;
  hint?: string;
  action?: React.ReactNode;
};

export function EmptyState({ title, description, hint, action }: EmptyStateProps) {
  return (
    <div
      className="flex w-full max-w-md flex-col items-center rounded-2xl border border-dashed border-border/80 bg-card/50 px-6 py-12 text-center"
      role="status"
    >
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
      {hint ? (
        <pre className="mt-4 w-full overflow-x-auto rounded-xl bg-black/40 px-3 py-2 text-left text-[11px] text-sky-200/90">
          {hint}
        </pre>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
