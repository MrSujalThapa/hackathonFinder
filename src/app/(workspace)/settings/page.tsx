import { SourcesPanel } from "@/components/settings/SourcesPanel";
import { OpenSheetLink } from "@/components/shell/OpenSheetLink";
import { PageHeader } from "@/components/shell/PageHeader";
import {
  getGoogleSheetTab,
  getServerEnv,
  hasGoogleSheetsConfig,
  hasSupabaseConfig,
  hasXConfig,
} from "@/config/env";
import {
  listSourceHealthSnapshots,
  readSourceSettings,
} from "@/lib/sources";
import { isMockCandidatesEnabled } from "@/server/candidates/service";
import { getOwnerDiagnostics } from "@/server/diagnostics";

export default async function SettingsPage() {
  const env = getServerEnv();
  const diagnostics = await getOwnerDiagnostics().catch(() => null);
  const sheetsConfigured = hasGoogleSheetsConfig(env);
  const sheetTab = getGoogleSheetTab(env);
  const publicSheetUrl = env.NEXT_PUBLIC_GOOGLE_SHEET_URL?.trim() || null;
  const sourceSettings = readSourceSettings();
  const sourceSnapshots = listSourceHealthSnapshots();

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
        description="Connection status and integrations."
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
            Set <code className="text-foreground/80">DEMO_MODE=true</code> or{" "}
            <code className="text-foreground/80">USE_MOCK_CANDIDATES=true</code> in
            `.env.local` for fixture Queue data. Demo mode also forces dry-run
            discovery persistence.
          </p>
        </section>

        <section className="rounded-2xl border border-border bg-card/80 p-5">
          <h2 className="text-sm font-semibold">Google Sheet</h2>
          <p className="mt-1 text-sm text-muted">
            Credentials —{" "}
            {sheetsConfigured ? "present" : "missing"}. Tab —{" "}
            <code className="text-foreground/80">{sheetTab}</code>
            {publicSheetUrl ? null : (
              <>
                {" "}
                · Public URL not set (
                <code className="text-foreground/80">
                  NEXT_PUBLIC_GOOGLE_SHEET_URL
                </code>
                ).
              </>
            )}
          </p>
          <p className="mt-2 text-xs text-muted">
            Verify connectivity with{" "}
            <code className="text-foreground/80">npm run check:sheets</code>.
          </p>
          <OpenSheetLink className="mt-4 inline-flex rounded-xl border border-border px-3 py-2 text-sm text-muted transition-colors hover:border-sky-500/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60" />
        </section>

        <SourcesPanel
          initial={{
            sources: sourceSnapshots,
            enabled: sourceSettings.enabled,
          }}
        />

        <section className="rounded-2xl border border-border bg-card/80 p-5">
          <h2 className="text-sm font-semibold">Service status</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li>
              Supabase config —{" "}
              {hasSupabaseConfig(env) ? "present" : "missing"} (run{" "}
              <code className="text-foreground/80">npm run check:supabase</code>)
            </li>
            <li>Mock candidates — {mockEnabled ? "on" : "off"}</li>
            <li>
              Google Sheets — {sheetsConfigured ? "configured" : "not configured"}{" "}
              (run{" "}
              <code className="text-foreground/80">npm run check:sheets</code>)
            </li>
            <li>
              X MCP — {hasXConfig(env) ? "configured" : "not configured"} (opt-in
              via{" "}
              <code className="text-foreground/80">--sources=x</code>; diagnose
              with{" "}
              <code className="text-foreground/80">npm run check:x</code>)
            </li>
          </ul>
        </section>

        <section className="rounded-2xl border border-border bg-card/80 p-5">
          <h2 className="text-sm font-semibold">Production diagnostics</h2>
          <dl className="mt-3 grid gap-3 text-sm text-muted sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase text-muted/80">Provider/model</dt>
              <dd className="mt-1 text-foreground">
                {diagnostics?.config.providerModel ?? "unavailable"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted/80">Last Sheet sync</dt>
              <dd className="mt-1 text-foreground">
                {diagnostics?.lastSheetSync
                  ? new Date(
                      diagnostics.lastSheetSync.sheetAppendedAt,
                    ).toLocaleString()
                  : "none recorded"}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase text-muted/80">Latest agent run</dt>
              <dd className="mt-1 text-foreground">
                {diagnostics?.latestAgentRun
                  ? `${diagnostics.latestAgentRun.status} · ${diagnostics.latestAgentRun.sources.join(", ") || "no sources"} · ${diagnostics.latestAgentRun.newCandidates} new / ${diagnostics.latestAgentRun.updatedCandidates} updated`
                  : "none recorded"}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">
            Public health: <code className="text-foreground/80">/api/health</code>.
            Owner diagnostics are protected and never include secret values.
          </p>
        </section>
      </div>
    </section>
  );
}
