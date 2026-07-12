import type { SourceName } from "@/core/discovery/types";

/** Sources included in health diagnostics (never X by default). */
export const HEALTHABLE_SOURCES = [
  "mlh",
  "web",
  "hacklist",
  "devpost",
  "luma",
  "hakku",
] as const;

export type HealthableSourceName = (typeof HEALTHABLE_SOURCES)[number];

export type SourceHealthStatus =
  | "healthy"
  | "degraded"
  | "auth_required"
  | "unconfigured"
  | "disabled"
  | "failed";

export type SourceFailureCategory =
  | "not_registered"
  | "disabled"
  | "missing_api_key"
  | "auth_required"
  | "session_expired"
  | "selector_parser_failure"
  | "no_current_events"
  | "zero_matching_results"
  | "network"
  | "rate_limit"
  | "anti_bot"
  | "browser_missing"
  | "profile_missing"
  | "unknown";

export type SourceCapabilities = {
  publicDiscovery: boolean;
  authenticatedDiscovery: boolean;
  browserRequired: boolean;
};

/** Safe connection label for UI (never includes profile paths/cookies). */
export type SourceConnectionLabel =
  | "connected"
  | "reconnect_required"
  | "not_connected"
  | "unknown"
  | "n/a";

export type SourceDiscoveryMode = "public" | "authenticated" | "unconfigured" | "disabled";

export type SourceHealth = {
  source: HealthableSourceName;
  status: SourceHealthStatus;
  enabled: boolean;
  authenticated?: boolean;
  lastCheckedAt: string;
  lastSuccessfulAt?: string;
  durationMs?: number;
  leadsFound?: number;
  accepted?: number;
  failureCategory?: SourceFailureCategory;
  safeMessage?: string;
  capabilities: SourceCapabilities;
  /** UI-only safe extras */
  connectionStatus?: SourceConnectionLabel;
  mode?: SourceDiscoveryMode;
  displayName: string;
};

export type SourceSettingsState = {
  enabled: Record<HealthableSourceName, boolean>;
  lastSuccessfulAt: Partial<Record<HealthableSourceName, string>>;
  lastHealth: Partial<Record<HealthableSourceName, SourceHealth>>;
};

export function isHealthableSource(value: string): value is HealthableSourceName {
  return (HEALTHABLE_SOURCES as readonly string[]).includes(value);
}

export function assertHealthableSource(value: string): HealthableSourceName {
  if (!isHealthableSource(value)) {
    throw new Error(
      `Unknown or unsupported source for health checks: ${value}. Allowed: ${HEALTHABLE_SOURCES.join(", ")}`,
    );
  }
  return value;
}

export function toSourceName(source: HealthableSourceName): SourceName {
  return source;
}
