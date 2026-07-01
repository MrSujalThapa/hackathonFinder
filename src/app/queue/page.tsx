export default function QueuePage() {
  return (
    <section className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 text-center">
      <div className="w-full max-w-[420px] rounded-2xl border border-border bg-card p-8 shadow-2xl">
        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted">
          Approval Queue
        </p>
        <h1 className="mb-3 text-2xl font-bold tracking-tight">Queue</h1>
        <p className="text-sm leading-relaxed text-muted">
          Swipe deck coming soon. Run the agent locally to discover hackathons,
          then review candidates here.
        </p>
      </div>
      <p className="max-w-sm text-xs text-muted">
        Tap card to view details — full Tinder-style UI lands in a later step.
      </p>
    </section>
  );
}
