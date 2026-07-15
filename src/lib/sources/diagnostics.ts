import { getCollector } from "@/collectors/registry";
import type { CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";
import type { DiscoveryPreferences } from "@/core/discovery/types";
import {
  hakkuProfileExists,
  readHakkuSessionMeta,
} from "@/lib/browser/sessionMeta";
import { hasSearchConfig, getServerEnv } from "@/config/env";
import {
  SOURCE_CAPABILITIES,
  SOURCE_DISPLAY_NAMES,
  discoveryModeFor,
} from "@/lib/sources/config";
import { classifyCollectorResult } from "@/lib/sources/classify";
import { sanitizeDiagnosticMessage } from "@/lib/sources/sanitize";
import { recordSourceHealth, readSourceSettings } from "@/lib/sources/settingsStore";
import {
  HEALTHABLE_SOURCES,
  type HealthableSourceName,
  type SourceConnectionLabel,
  type SourceFailureCategory,
  type SourceHealth,
  type SourceHealthStatus,
} from "@/lib/sources/types";

export const DIAGNOSTIC_TIMEOUT_MS = 12_000;
export const DIAGNOSTIC_MAX_RESULTS = 5;

function diagnosticPreferences(source: HealthableSourceName): DiscoveryPreferences {
  return {
    rawCommand: `source health check:${source}`,
    locations: ["Toronto", "Canada"],
    themes: ["AI"],
    modes: [],
    sources: [source],
    includeRemote: true,
    includeInPerson: true,
    maxResults: DIAGNOSTIC_MAX_RESULTS,
  };
}

function buildCollectorInput(source: HealthableSourceName): CollectorInput {
  return {
    preferences: diagnosticPreferences(source),
    maxResults: DIAGNOSTIC_MAX_RESULTS,
    timeoutMs: DIAGNOSTIC_TIMEOUT_MS,
    dryRun: true,
    requestId: `source-health-${source}`,
  };
}

function hakkuConnectionLabel(): {
  connectionStatus: SourceConnectionLabel;
  authenticated: boolean;
  lastVerifiedAt?: string;
  failureCategory?: SourceFailureCategory;
  statusHint?: SourceHealthStatus;
  message?: string;
} {
  const meta = readHakkuSessionMeta();
  const profileExists = hakkuProfileExists();

  if (!profileExists && (!meta || meta.status === "profile_missing")) {
    return {
      connectionStatus: "not_connected",
      authenticated: false,
      failureCategory: "profile_missing",
      statusHint: "auth_required",
      message:
        "Hakku browser profile is not connected. Connect locally with `npm run source:connect -- hakku`.",
    };
  }

  if (!meta) {
    return {
      connectionStatus: profileExists ? "unknown" : "not_connected",
      authenticated: false,
      failureCategory: profileExists ? undefined : "profile_missing",
      statusHint: "auth_required",
      message: profileExists
        ? "Hakku profile exists but connection status is unknown. Run `npm run source:status -- hakku`."
        : "Hakku is not connected. Connect locally with `npm run source:connect -- hakku`.",
    };
  }

  if (meta.status === "connected") {
    return {
      connectionStatus: "connected",
      authenticated: true,
      lastVerifiedAt: meta.lastVerifiedAt,
    };
  }

  if (meta.status === "reconnect_required") {
    return {
      connectionStatus: "reconnect_required",
      authenticated: false,
      lastVerifiedAt: meta.lastVerifiedAt,
      failureCategory: "session_expired",
      statusHint: "auth_required",
      message:
        "Hakku session needs reconnect. Run `npm run source:connect -- hakku`.",
    };
  }

  if (meta.status === "profile_missing") {
    return {
      connectionStatus: "not_connected",
      authenticated: false,
      failureCategory: "profile_missing",
      statusHint: "auth_required",
      message:
        "Hakku browser profile is missing. Connect locally with `npm run source:connect -- hakku`.",
    };
  }

  return {
    connectionStatus: "unknown",
    authenticated: false,
    lastVerifiedAt: meta.lastVerifiedAt,
    statusHint: "auth_required",
    message:
      "Hakku connection status is unknown. Run `npm run source:status -- hakku`.",
  };
}

function snapshotWithoutLive(
  source: HealthableSourceName,
  enabled: boolean,
  prior?: SourceHealth,
): SourceHealth {
  const now = new Date().toISOString();
  const capabilities = SOURCE_CAPABILITIES[source];
  const displayName = SOURCE_DISPLAY_NAMES[source];

  if (!enabled) {
    return {
      source,
      displayName,
      status: "disabled",
      enabled: false,
      lastCheckedAt: prior?.lastCheckedAt ?? now,
      lastSuccessfulAt: prior?.lastSuccessfulAt,
      failureCategory: "disabled",
      safeMessage: `${displayName} is disabled in Settings.`,
      capabilities,
      connectionStatus: source === "hakku" ? hakkuConnectionLabel().connectionStatus : "n/a",
      mode: "disabled",
    };
  }

  if (source === "web" && !hasSearchConfig(getServerEnv())) {
    return {
      source,
      displayName,
      status: "unconfigured",
      enabled: true,
      lastCheckedAt: prior?.lastCheckedAt ?? now,
      lastSuccessfulAt: prior?.lastSuccessfulAt,
      failureCategory: "missing_api_key",
      safeMessage:
        "Web search is not configured. Set SEARCH_PROVIDER and SEARCH_API_KEY (or SEARCH_PROVIDER=mock).",
      capabilities,
      connectionStatus: "n/a",
      mode: "unconfigured",
    };
  }

  if (source === "hakku") {
    const hakku = hakkuConnectionLabel();
    if (prior) {
      return {
        ...prior,
        enabled: true,
        authenticated: hakku.authenticated,
        connectionStatus: hakku.connectionStatus,
        mode: discoveryModeFor("hakku", true, hakku.authenticated),
        lastSuccessfulAt: prior.lastSuccessfulAt,
      };
    }
    return {
      source,
      displayName,
      status: hakku.statusHint ?? "auth_required",
      enabled: true,
      authenticated: hakku.authenticated,
      lastCheckedAt: now,
      failureCategory: hakku.failureCategory ?? "auth_required",
      safeMessage: hakku.message,
      capabilities,
      connectionStatus: hakku.connectionStatus,
      mode: discoveryModeFor("hakku", true, hakku.authenticated),
    };
  }

  if (source === "luma") {
    if (prior) {
      return {
        ...prior,
        enabled: true,
        mode: "public",
        connectionStatus: "n/a",
        safeMessage:
          prior.safeMessage ??
          "Luma public mode. Connected/authenticated mode is unavailable.",
      };
    }
    return {
      source,
      displayName,
      status: "degraded",
      enabled: true,
      lastCheckedAt: now,
      safeMessage:
        "Luma public mode available. Connected mode unavailable / not connected. Run a live check for current status.",
      capabilities,
      connectionStatus: "n/a",
      mode: "public",
      failureCategory: undefined,
    };
  }

  if (prior) {
    return { ...prior, enabled: true };
  }

  return {
    source,
    displayName,
    status: "degraded",
    enabled: true,
    lastCheckedAt: now,
    safeMessage: "Not checked yet. Run a live source check.",
    capabilities,
    connectionStatus: "n/a",
    mode: discoveryModeFor(source, true),
  };
}

async function runCollectorDiagnostic(
  source: HealthableSourceName,
): Promise<CollectorResult> {
  const collector = getCollector(source);
  if (!collector) {
    const result = emptyCollectorResult(source);
    result.errors.push(`Collector not registered: ${source}`);
    return result;
  }

  try {
    return await collector.collect(buildCollectorInput(source));
  } catch (error) {
    const result = emptyCollectorResult(source);
    result.errors.push(
      error instanceof Error ? error.message : `Collector ${source} threw`,
    );
    return result;
  }
}

export async function checkSourceHealth(
  source: HealthableSourceName,
  options: { live?: boolean; persist?: boolean } = {},
): Promise<SourceHealth> {
  const live = options.live ?? true;
  const persist = options.persist ?? true;
  const settings = readSourceSettings();
  const enabled = settings.enabled[source];
  const prior = settings.lastHealth[source];
  const lastSuccessfulAt = settings.lastSuccessfulAt[source] ?? prior?.lastSuccessfulAt;

  if (!live) {
    return snapshotWithoutLive(source, enabled, prior);
  }

  const checkedAt = new Date().toISOString();
  const capabilities = SOURCE_CAPABILITIES[source];
  const displayName = SOURCE_DISPLAY_NAMES[source];

  if (!enabled) {
    const health: SourceHealth = {
      source,
      displayName,
      status: "disabled",
      enabled: false,
      lastCheckedAt: checkedAt,
      lastSuccessfulAt,
      failureCategory: "disabled",
      safeMessage: `${displayName} is disabled in Settings.`,
      capabilities,
      connectionStatus: source === "hakku" ? hakkuConnectionLabel().connectionStatus : "n/a",
      mode: "disabled",
    };
    if (persist) recordSourceHealth(health);
    return health;
  }

  const collector = getCollector(source);
  if (!collector) {
    const health: SourceHealth = {
      source,
      displayName,
      status: "failed",
      enabled: true,
      lastCheckedAt: checkedAt,
      lastSuccessfulAt,
      failureCategory: "not_registered",
      safeMessage: `${displayName} collector is not registered.`,
      capabilities,
      connectionStatus: "n/a",
      mode: discoveryModeFor(source, true),
    };
    if (persist) recordSourceHealth(health);
    return health;
  }

  // Pre-flight: web search config
  if (source === "web" && !hasSearchConfig(getServerEnv())) {
    const health: SourceHealth = {
      source,
      displayName,
      status: "unconfigured",
      enabled: true,
      lastCheckedAt: checkedAt,
      lastSuccessfulAt,
      failureCategory: "missing_api_key",
      safeMessage:
        "Web search is not configured. Set SEARCH_PROVIDER and SEARCH_API_KEY (or SEARCH_PROVIDER=mock).",
      capabilities,
      connectionStatus: "n/a",
      mode: "unconfigured",
    };
    if (persist) recordSourceHealth(health);
    return health;
  }

  // Pre-flight: hakku connection (still may run collector for live signal)
  let hakkuMeta:
    | ReturnType<typeof hakkuConnectionLabel>
    | undefined;
  if (source === "hakku") {
    hakkuMeta = hakkuConnectionLabel();
    if (!hakkuMeta.authenticated && hakkuMeta.connectionStatus === "not_connected") {
      const health: SourceHealth = {
        source,
        displayName,
        status: "auth_required",
        enabled: true,
        authenticated: false,
        lastCheckedAt: checkedAt,
        lastSuccessfulAt,
        failureCategory: hakkuMeta.failureCategory ?? "auth_required",
        safeMessage: hakkuMeta.message,
        capabilities,
        connectionStatus: hakkuMeta.connectionStatus,
        mode: "unconfigured",
      };
      if (persist) recordSourceHealth(health);
      return health;
    }
  }

  const result = await runCollectorDiagnostic(source);
  const classified = classifyCollectorResult(source, result, {
    authenticated: hakkuMeta?.authenticated,
  });

  let status = classified.status;
  let failureCategory = classified.failureCategory;
  let safeMessage = classified.safeMessage;

  if (source === "luma") {
    const lumaNote = "Public mode. Connected mode unavailable / not connected.";
    safeMessage = safeMessage ? `${safeMessage} ${lumaNote}` : lumaNote;
  }

  if (source === "hakku" && hakkuMeta) {
    if (status === "healthy" || status === "degraded") {
      // keep
    } else if (hakkuMeta.statusHint && status !== "failed") {
      status = hakkuMeta.statusHint;
      failureCategory = failureCategory ?? hakkuMeta.failureCategory;
      safeMessage = safeMessage ?? hakkuMeta.message;
    }
  }

  const successStamp =
    status === "healthy" || (classified.leadsFound > 0 && status !== "failed")
      ? checkedAt
      : lastSuccessfulAt;

  const health: SourceHealth = {
    source,
    displayName,
    status,
    enabled: true,
    authenticated: source === "hakku" ? Boolean(hakkuMeta?.authenticated) : undefined,
    lastCheckedAt: checkedAt,
    lastSuccessfulAt: successStamp,
    durationMs: result.durationMs,
    leadsFound: classified.leadsFound,
    accepted: classified.accepted,
    failureCategory,
    safeMessage: safeMessage ? sanitizeDiagnosticMessage(safeMessage) : undefined,
    capabilities,
    connectionStatus:
      source === "hakku" ? hakkuMeta?.connectionStatus ?? "unknown" : "n/a",
    mode:
      source === "luma"
        ? "public"
        : discoveryModeFor(source, true, hakkuMeta?.authenticated),
  };

  if (persist) recordSourceHealth(health);
  return health;
}

export async function checkAllSourcesHealth(
  options: { live?: boolean; persist?: boolean } = {},
): Promise<SourceHealth[]> {
  const results: SourceHealth[] = [];
  for (const source of HEALTHABLE_SOURCES) {
    results.push(await checkSourceHealth(source, options));
  }
  return results;
}

export function listSourceHealthSnapshots(): SourceHealth[] {
  const settings = readSourceSettings();
  return HEALTHABLE_SOURCES.map((source) =>
    snapshotWithoutLive(source, settings.enabled[source], settings.lastHealth[source]),
  );
}
