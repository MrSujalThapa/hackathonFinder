import type { SourceName } from "@/core/discovery/types";

/** Recommended defaults after collector validation. X is never included. */
export const DISCOVERY_DEFAULT_SOURCES: SourceName[] = [
  "mlh",
  "hacklist",
  "devpost",
  "luma",
  "web",
];

/** Allowlisted sources for web/API jobs (mock is local/dev only). */
export const DISCOVERY_API_SOURCE_ALLOWLIST: SourceName[] = [
  "mlh",
  "hacklist",
  "devpost",
  "luma",
  "web",
  "hakku",
  "mock",
];

export type SourceHealthHint =
  | "healthy"
  | "degraded"
  | "auth_required"
  | "unconfigured"
  | "disabled"
  | "disconnected"
  | "unknown";

export type SourceAvailability = {
  source: SourceName;
  enabled: boolean;
  health: SourceHealthHint;
  /** Safe, user-visible reason when skipped or degraded. */
  reason?: string;
};

export type SelectSourcesInput = {
  /** Explicit sources from command/CLI/API. Empty means use defaults. */
  requestedSources?: SourceName[];
  /** When true, include every enabled usable source (not X). */
  allSources?: boolean;
  /** Enabled sources from Settings; defaults to DISCOVERY_DEFAULT_SOURCES. */
  enabledSources?: SourceName[];
  /** Per-source availability overrides (tests / diagnostics). */
  availability?: Partial<Record<SourceName, SourceAvailability>>;
  /** Hakku connected state; when false, hakku is skipped with a visible reason. */
  hakkuConnected?: boolean;
  /** Include mock (tests / local fixtures only). */
  allowMock?: boolean;
};

export type SourceSelectionResult = {
  effectiveSources: SourceName[];
  skipped: Array<{ source: SourceName; reason: string }>;
  warnings: string[];
  planMessage: string;
  availabilityBySource: Partial<Record<SourceName, SourceAvailability>>;
};

function defaultAvailability(
  source: SourceName,
  hakkuConnected: boolean,
): SourceAvailability {
  if (source === "hakku") {
    return hakkuConnected
      ? { source, enabled: true, health: "healthy" }
      : {
          source,
          enabled: true,
          health: "disconnected",
          reason: "Hakku disconnected — connect a browser profile before including this source",
        };
  }
  if (source === "x") {
    return {
      source,
      enabled: false,
      health: "disabled",
      reason: "X is not included by default",
    };
  }
  if (source === "mock") {
    return {
      source,
      enabled: false,
      health: "disabled",
      reason: "Mock source is for local fixtures only",
    };
  }
  return { source, enabled: true, health: "healthy" };
}

/**
 * Resolve which collectors to run.
 *
 * Rules:
 * - No X by default.
 * - Honor enabled defaults from Settings when no sources are specified.
 * - Skip disconnected Hakku with a visible reason (never silent).
 * - Do not silently fall back to MLH+web-only when other sources are enabled.
 * - Explicit requests report missing/unavailable sources without substitution.
 */
export function selectDiscoverySources(
  input: SelectSourcesInput = {},
): SourceSelectionResult {
  const hakkuConnected = input.hakkuConnected === true;
  const enabled =
    input.enabledSources && input.enabledSources.length > 0
      ? [...input.enabledSources]
      : [...DISCOVERY_DEFAULT_SOURCES];

  // Hakku stays out of defaults unless explicitly enabled via Settings / request.
  // Connection is checked separately below — never silently omit other sources.
  const baseEnabled = new Set<SourceName>(
    enabled.filter((source) => source !== "x"),
  );

  const availability: Record<string, SourceAvailability> = {};
  for (const source of [
    ...DISCOVERY_DEFAULT_SOURCES,
    "hakku",
    "x",
    "mock",
  ] as SourceName[]) {
    availability[source] =
      input.availability?.[source] ?? defaultAvailability(source, hakkuConnected);
  }
  for (const [source, value] of Object.entries(input.availability ?? {})) {
    availability[source] = value;
  }

  if (input.allowMock) {
    availability.mock = input.availability?.mock ?? {
      source: "mock",
      enabled: true,
      health: "healthy",
    };
  }

  const skipped: Array<{ source: SourceName; reason: string }> = [];
  const warnings: string[] = [];
  const effective: SourceName[] = [];

  const candidates: SourceName[] = (() => {
    if (input.allSources) {
      return [...baseEnabled];
    }
    if (input.requestedSources && input.requestedSources.length > 0) {
      return [...input.requestedSources];
    }
    return [...baseEnabled];
  })();

  const seen = new Set<SourceName>();
  for (const source of candidates) {
    if (seen.has(source)) continue;
    seen.add(source);

    if (source === "x") {
      skipped.push({ source, reason: "X is not included by default" });
      warnings.push("Skipped x: X is not included by default");
      continue;
    }

    if (source === "mock" && !input.allowMock) {
      skipped.push({ source, reason: "Mock source requires allowMock" });
      warnings.push("Skipped mock: mock source requires allowMock");
      continue;
    }

    const status =
      availability[source] ?? defaultAvailability(source, hakkuConnected);

    if (!status.enabled || status.health === "disabled") {
      const reason = status.reason ?? `${source} is disabled`;
      skipped.push({ source, reason });
      warnings.push(`Skipped ${source}: ${reason}`);
      continue;
    }

    if (status.health === "disconnected" || status.health === "auth_required") {
      const reason =
        status.reason ??
        (status.health === "auth_required"
          ? `${source} requires authentication`
          : `${source} is disconnected`);
      skipped.push({ source, reason });
      warnings.push(`Skipped ${source}: ${reason}`);
      continue;
    }

    if (status.health === "unconfigured") {
      const reason = status.reason ?? `${source} is unconfigured`;
      skipped.push({ source, reason });
      warnings.push(`Skipped ${source}: ${reason}`);
      continue;
    }

    // degraded still runs (visible via warnings)
    if (status.health === "degraded") {
      warnings.push(
        `${source} is degraded${status.reason ? `: ${status.reason}` : ""}`,
      );
    }

    effective.push(source);
  }

  if (effective.length === 0) {
    warnings.push(
      "No usable sources selected. Enable sources in Settings or connect Hakku.",
    );
  }

  const planMessage =
    effective.length > 0
      ? `Sources: ${effective.join(", ")}`
      : "Sources: (none)";

  return {
    effectiveSources: effective,
    skipped,
    warnings,
    planMessage,
    availabilityBySource: availability,
  };
}

export function assertApiSourcesAllowlisted(sources: SourceName[]): void {
  const allowed = new Set(DISCOVERY_API_SOURCE_ALLOWLIST);
  const unknown = sources.filter((source) => !allowed.has(source));
  if (unknown.length > 0) {
    throw new Error(
      `Source(s) not allowlisted for web discovery: ${unknown.join(", ")}`,
    );
  }
}
