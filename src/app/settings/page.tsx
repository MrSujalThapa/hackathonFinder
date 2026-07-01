export default function SettingsPage() {
  return (
    <section className="flex min-h-[70dvh] flex-col gap-6">
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-widest text-muted">
          Configuration
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      </div>

      <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
        <div>
          <h2 className="text-sm font-semibold">Google Sheet</h2>
          <p className="mt-1 text-sm text-muted">
            Sheet link and append status will appear here after integration.
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Discovery sources</h2>
          <p className="mt-1 text-sm text-muted">
            HackList, Hakku, Devpost, MLH, Luma, web search, and X/Twitter toggles
            coming soon.
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Service status</h2>
          <p className="mt-1 text-sm text-muted">
            Supabase, search provider, and X MCP connection checks will appear here.
          </p>
        </div>
      </div>
    </section>
  );
}
