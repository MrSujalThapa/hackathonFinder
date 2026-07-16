/**
 * Custom-source runtime routing (B4).
 *
 * Production path is always the DirectoryCrawlKernel custom adapter.
 * Obsolete flags (shadow, rollback_v1, GENERIC_SCRAPER_V2_MODE) are ignored
 * with a one-time deprecation warning when present.
 *
 * Custom V1 collector remains on disk but unreachable from production routing
 * until the soak deletion gate is satisfied (see docs/discovery/B4_REMOVE_OBSOLETE.md).
 */

export type CustomSourceRuntimeMode = "kernel";

const DEPRECATED_FLAG_KEYS = [
  "CUSTOM_SOURCE_ROLLBACK_V1",
  "CUSTOM_SOURCE_SHADOW",
  "CUSTOM_CRAWL_MODE",
  "CUSTOM_SOURCE_RUNTIME",
  "GENERIC_SCRAPER_V2_MODE",
] as const;

let deprecationLogged = false;

function deprecatedFlagsPresent(env: Record<string, string | undefined>): string[] {
  return DEPRECATED_FLAG_KEYS.filter((key) => {
    const value = String(env[key] ?? "").trim();
    if (!value) return false;
    if (key === "GENERIC_SCRAPER_V2_MODE" && value.toLowerCase() === "off") return true;
    if (
      (key === "CUSTOM_CRAWL_MODE" || key === "CUSTOM_SOURCE_RUNTIME") &&
      ["kernel", "live", "off", "production"].includes(value.toLowerCase())
    ) {
      return false;
    }
    return true;
  });
}

export function warnDeprecatedCustomRoutingFlags(
  env?: Record<string, string | undefined>,
  logger?: (message: string) => void,
): void {
  const source = env ?? process.env;
  const present = deprecatedFlagsPresent(source);
  if (present.length === 0 || deprecationLogged) return;
  deprecationLogged = true;
  const message =
    `[custom] Ignoring obsolete scraper flags (${present.join(", ")}); ` +
    "custom sources always use DirectoryCrawlKernel. See docs/discovery/B4_REMOVE_OBSOLETE.md.";
  logger?.(message);
  if (!logger && typeof console !== "undefined") {
    console.warn(message);
  }
}

/** Always kernel — retained for call-site compatibility. */
export function readCustomSourceRuntimeMode(
  env?: Record<string, string | undefined>,
): CustomSourceRuntimeMode {
  warnDeprecatedCustomRoutingFlags(env);
  return "kernel";
}

/** @deprecated Shadow comparison removed in B4. */
export function isCustomSourceShadowEnabled(
  _env?: Record<string, string | undefined>,
): boolean {
  return false;
}

/** @deprecated V1 rollback unreachable in B4 pending soak file deletion. */
export function isCustomSourceRollbackV1(
  _env?: Record<string, string | undefined>,
): boolean {
  return false;
}

export const CUSTOM_V1_SOAK_BLOCKER =
  "Custom V1 file deletion awaits soak after B2 kernel cutover 2026-07-16 (commit 578e332): " +
  "calendar gate 2026-07-30 (14 days) OR 3 controlled live custom runs across ≥3 distinct days " +
  "with no severity-1 regression. V1 remains unreachable from production routing (B4).";
