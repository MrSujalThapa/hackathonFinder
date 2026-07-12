"use client";

import { TechnicalLabel } from "@/components/blueprint/TechnicalLabel";
import type { SourceHealth } from "@/lib/terminal/types";

type TerminalSourceRailProps = {
  sources: SourceHealth[];
  collapsed?: boolean;
  onToggle?: () => void;
  loading?: boolean;
  error?: string | null;
};

function statusColor(status: SourceHealth["status"]): string {
  switch (status) {
    case "healthy":
      return "var(--accent-approve)";
    case "degraded":
    case "auth_required":
      return "var(--accent-warn)";
    case "failed":
    case "unconfigured":
      return "var(--accent-danger)";
    case "disabled":
      return "var(--muted)";
    default:
      return "var(--muted)";
  }
}

export function TerminalSourceRail({
  sources,
  collapsed = false,
  onToggle,
  loading = false,
  error = null,
}: TerminalSourceRailProps) {
  return (
    <aside
      className="border border-[color-mix(in_oklab,var(--ink-line)_65%,transparent)] bg-[color-mix(in_oklab,var(--panel)_70%,transparent)] lg:w-[16rem] lg:shrink-0"
      aria-label="Source status"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[color-mix(in_oklab,var(--ink-line)_55%,transparent)] px-3 py-2.5">
        <TechnicalLabel className="mb-0">Sources</TechnicalLabel>
        {onToggle ? (
          <button
            type="button"
            className="hf-focus min-h-[44px] min-w-[44px] px-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted lg:hidden"
            onClick={onToggle}
            aria-expanded={!collapsed}
          >
            {collapsed ? "Show" : "Hide"}
          </button>
        ) : null}
      </div>

      <div
        className={[
          "max-h-48 space-y-1 overflow-y-auto px-2 py-2 lg:max-h-none",
          collapsed ? "hidden lg:block" : "block",
        ].join(" ")}
      >
          {loading ? (
            <p className="px-1 py-2 font-mono text-xs text-muted">Checking…</p>
          ) : null}
          {error ? (
            <p className="px-1 py-2 font-mono text-xs text-[color-mix(in_oklab,var(--accent-warn)_90%,white)]">
              {error}
            </p>
          ) : null}
          {!loading && !error && sources.length === 0 ? (
            <p className="px-1 py-2 font-mono text-xs text-muted">
              Run /sources to load health.
            </p>
          ) : null}
          {sources.map((src) => (
            <div
              key={src.source}
              className="flex items-start gap-2 px-1 py-2"
            >
              <span
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{ background: statusColor(src.status) }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs text-foreground">
                  {src.source}
                  {!src.enabled ? (
                    <span className="text-muted"> · off</span>
                  ) : null}
                </p>
                <p className="font-mono text-[11px] text-muted">
                  {src.status.replace(/_/g, " ")}
                  {src.safeMessage ? ` · ${src.safeMessage}` : null}
                </p>
              </div>
            </div>
          ))}
          <p className="px-1 pb-1 pt-2 font-mono text-[10px] text-muted/80">
            Details in{" "}
            <a
              href="/settings"
              className="hf-focus text-[color-mix(in_oklab,var(--accent-save)_88%,white)] underline-offset-2 hover:underline"
            >
              Settings
            </a>
          </p>
        </div>
    </aside>
  );
}
