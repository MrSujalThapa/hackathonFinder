import { PageHeader } from "@/components/shell/PageHeader";
import { hasSupabaseConfig, getServerEnv } from "@/config/env";
import { isMockCandidatesEnabled } from "@/server/candidates/service";

export default function SettingsPage() {
  const env = getServerEnv();
  let mockEnabled = false;
  let mockError: string | null = null;
  try {
    mockEnabled = isMockCandidatesEnabled();
  } catch (error) {
    mockError = error instanceof Error ? error.message : "Mock mode misconfigured";
  }

  return (
    <section className="mx-auto w-full max-w-2xl">
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Connection status and upcoming integrations."
      />

      <div className="space-y-4">
        <section className="rounded-2xl border border-border bg-card/80 p-5">
          <h2 className="text-sm font-semibold">Candidate data mode</h2>
          <p className="mt-1 text-sm text-muted">
            {mockEnabled
              ? "Mock candidates are enabled for local UI development."
              : "Using Supabase-backed candidates (when reachable)."}
          </p>
          {mockError ? (
            <p className="mt-2 text-sm text-amber-200">{mockError}</p>
          ) : null}
          <p className="mt-2 text-xs text-muted">
            Set <code className="text-foreground/80">USE_MOCK_CANDIDATES=true</code> in
            `.env.local` only for development.
          </p>
        </section>

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
            <li>
              Supabase config —{" "}
              {hasSupabaseConfig(env) ? "present" : "missing"} (run{" "}
              <code className="text-foreground/80">npm run check:supabase</code>)
            </li>
            <li>Mock candidates — {mockEnabled ? "on" : "off"}</li>
            <li>Google Sheets — not configured yet</li>
            <li>X MCP — not configured yet</li>
          </ul>
        </section>
      </div>
    </section>
  );
}
