import { PageHeader } from "@/components/shell/PageHeader";

export default function SettingsPage() {
  return (
    <section className="mx-auto w-full max-w-2xl">
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Connection status and upcoming integrations."
      />

      <div className="space-y-4">
        <section className="rounded-2xl border border-border bg-card/80 p-5">
          <h2 className="text-sm font-semibold">Google Sheet</h2>
          <p className="mt-1 text-sm text-muted">
            Sheet link and append status will appear here after Step 6.
          </p>
          <button
            type="button"
            disabled
            className="mt-4 rounded-xl border border-border px-3 py-2 text-sm text-muted opacity-60"
          >
            Open Sheet (soon)
          </button>
        </section>

        <section className="rounded-2xl border border-border bg-card/80 p-5">
          <h2 className="text-sm font-semibold">Discovery sources</h2>
          <p className="mt-1 text-sm text-muted">
            HackList, Devpost, and Hakku are available via the CLI. MLH, Luma,
            web search, and X/Twitter MCP arrive later.
          </p>
        </section>

        <section className="rounded-2xl border border-border bg-card/80 p-5">
          <h2 className="text-sm font-semibold">Service status</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li>Supabase — run <code className="text-foreground/80">npm run check:supabase</code></li>
            <li>Google Sheets — not configured yet</li>
            <li>X MCP — not configured yet</li>
          </ul>
        </section>
      </div>
    </section>
  );
}
