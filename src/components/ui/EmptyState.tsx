type EmptyStateProps = {
  title: string;
  description: string;
  hint?: string;
  action?: React.ReactNode;
};

export function EmptyState({ title, description, hint, action }: EmptyStateProps) {
  return (
    <div className="w-full max-w-xl py-8 text-left" role="status">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
      {hint ? (
        <pre className="mt-4 w-full overflow-x-auto rounded-[var(--radius-md)] bg-inset px-3 py-2 text-left text-[11px] text-sky-200/90">
          {hint}
        </pre>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
