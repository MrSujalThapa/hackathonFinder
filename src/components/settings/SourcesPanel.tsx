"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { HealthableSourceName, SourceHealth } from "@/lib/sources/types";
import { HEALTHABLE_SOURCES } from "@/lib/sources/types";
import {
  DEFAULT_SOURCE_ENABLED,
  SOURCE_DISPLAY_NAMES,
} from "@/lib/sources/config";

type SourcesPayload = {
  sources: SourceHealth[];
  enabled: Record<HealthableSourceName, boolean>;
};

function statusTone(status: SourceHealth["status"]): string {
  switch (status) {
    case "healthy":
      return "text-emerald-300";
    case "degraded":
      return "text-amber-200";
    case "auth_required":
      return "text-sky-300";
    case "unconfigured":
    case "disabled":
      return "text-muted";
    case "failed":
      return "text-rose-300";
    default:
      return "text-muted";
  }
}

function formatWhen(value?: string): string {
  if (!value) return "never";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json()) as {
    data: T | null;
    error: { message?: string } | null;
  };
  if (!response.ok || body.error || !body.data) {
    throw new Error(body.error?.message ?? `Request failed (${response.status})`);
  }
  return body.data;
}

export function SourcesPanel({ initial }: { initial?: SourcesPayload }) {
  const [payload, setPayload] = useState<SourcesPayload | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState<HealthableSourceName | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    startTransition(async () => {
      try {
        setError(null);
        const data = await fetchJson<SourcesPayload>("/api/sources");
        setPayload(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load sources");
      }
    });
  }, []);

  useEffect(() => {
    if (!initial) refresh();
  }, [initial, refresh]);

  async function toggleEnabled(source: HealthableSourceName, enabled: boolean) {
    try {
      setError(null);
      const data = await fetchJson<{ enabled: Record<HealthableSourceName, boolean> }>(
        "/api/sources/settings",
        {
          method: "PATCH",
          body: JSON.stringify({ enabled: { [source]: enabled } }),
        },
      );
      setPayload((prev) => {
        if (!prev) return prev;
        return {
          enabled: data.enabled,
          sources: prev.sources.map((item) =>
            item.source === source
              ? {
                  ...item,
                  enabled,
                  status: enabled ? item.status : "disabled",
                  mode: enabled ? item.mode : "disabled",
                }
              : item,
          ),
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update source");
    }
  }

  async function runCheck(source: HealthableSourceName) {
    setChecking(source);
    setError(null);
    try {
      const health = await fetchJson<SourceHealth>(`/api/sources/${source}/check`, {
        method: "POST",
        body: "{}",
      });
      setPayload((prev) => {
        if (!prev) {
          return {
            enabled: { ...DEFAULT_SOURCE_ENABLED },
            sources: [health],
          };
        }
        return {
          ...prev,
          sources: prev.sources.map((item) =>
            item.source === source ? health : item,
          ),
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Live check failed");
    } finally {
      setChecking(null);
    }
  }

  const sources: SourceHealth[] =
    payload?.sources ??
    HEALTHABLE_SOURCES.map((source): SourceHealth => ({
      source,
      displayName: SOURCE_DISPLAY_NAMES[source],
      status: "degraded",
      enabled: true,
      lastCheckedAt: new Date(0).toISOString(),
      capabilities: {
        publicDiscovery: source !== "hakku",
        authenticatedDiscovery: source === "hakku",
        browserRequired: source === "hakku",
      },
    }));

  return (
    <section className="rounded-2xl border border-border bg-card/80 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Sources</h2>
          <p className="mt-1 text-sm text-muted">
            Collector health for MLH, Web, HackList, Devpost, Luma, and Hakku.
            X is opt-in and excluded from default checks.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={pending}
          className="rounded-xl border border-border px-3 py-2 text-sm text-muted transition-colors hover:border-sky-500/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 disabled:opacity-60"
        >
          {pending ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-amber-200">{error}</p> : null}

      <ul className="mt-4 space-y-3">
        {sources.map((source) => (
          <li
            key={source.source}
            className="rounded-xl border border-border/80 bg-black/20 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    {source.displayName}
                  </h3>
                  <span className={`text-xs uppercase tracking-wide ${statusTone(source.status)}`}>
                    {source.status.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {source.mode === "public"
                    ? "Public discovery"
                    : source.mode === "authenticated"
                      ? "Authenticated discovery"
                      : source.mode === "unconfigured"
                        ? "Needs setup"
                        : source.mode === "disabled"
                          ? "Disabled"
                          : source.capabilities.publicDiscovery
                            ? "Public discovery"
                            : "Authenticated discovery"}
                  {source.capabilities.browserRequired ? " · Browser required" : ""}
                  {source.connectionStatus && source.connectionStatus !== "n/a"
                    ? ` · ${source.connectionStatus.replace(/_/g, " ")}`
                    : ""}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="flex min-h-11 items-center gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={source.enabled}
                    onChange={(event) =>
                      void toggleEnabled(source.source, event.target.checked)
                    }
                    className="size-4 accent-sky-400"
                  />
                  Enabled
                </label>
                <button
                  type="button"
                  onClick={() => void runCheck(source.source)}
                  disabled={checking === source.source}
                  className="min-h-11 rounded-xl border border-border px-3 py-2 text-sm text-muted transition-colors hover:border-sky-500/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 disabled:opacity-60"
                >
                  {checking === source.source ? "Checking…" : "Check"}
                </button>
              </div>
            </div>

            <dl className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-2">
              <div>
                <dt className="uppercase tracking-wide text-muted/70">Last checked</dt>
                <dd className="mt-0.5 text-foreground/90">
                  {formatWhen(source.lastCheckedAt)}
                </dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide text-muted/70">Last successful</dt>
                <dd className="mt-0.5 text-foreground/90">
                  {formatWhen(source.lastSuccessfulAt)}
                </dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide text-muted/70">Latest leads</dt>
                <dd className="mt-0.5 text-foreground/90">
                  {source.leadsFound == null ? "—" : source.leadsFound}
                  {source.accepted != null ? ` accepted ${source.accepted}` : ""}
                </dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide text-muted/70">Failure</dt>
                <dd className="mt-0.5 text-foreground/90">
                  {source.failureCategory?.replace(/_/g, " ") ?? "—"}
                </dd>
              </div>
            </dl>

            {source.safeMessage ? (
              <p className="mt-2 text-sm text-muted">{source.safeMessage}</p>
            ) : null}

            {source.source === "hakku" ? (
              <p className="mt-2 text-xs text-muted">
                Connect locally with{" "}
                <code className="text-foreground/80">
                  npm run source:connect -- hakku
                </code>
                . Profile paths and cookies are never shown here.
              </p>
            ) : null}

            {source.source === "luma" ? (
              <p className="mt-2 text-xs text-muted">
                Public mode is supported. Connected mode is unavailable / not
                connected in this phase.
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-muted">
        CLI: <code className="text-foreground/80">npm run check:sources</code>{" "}
        or{" "}
        <code className="text-foreground/80">npm run check:source -- mlh</code>.
        Live checks are rate-limited.
      </p>
    </section>
  );
}
