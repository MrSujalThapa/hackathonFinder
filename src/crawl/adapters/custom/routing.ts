/**
 * B2 temporary custom-source routing flags.
 *
 * Default (accepted B2 behavior): kernel production path.
 * Invalid / missing values resolve to kernel — never silent V1.
 *
 * Flags (delete gate: B4 after ≤14 days soak OR 3 controlled live custom runs
 * across ≥3 days, whichever approved gate is reached):
 *
 * - CUSTOM_SOURCE_RUNTIME / CUSTOM_CRAWL_MODE
 *     kernel (default) | shadow | rollback_v1
 * - CUSTOM_SOURCE_ROLLBACK_V1=1
 *     explicit emergency V1 rollback (dev-only intent; logged)
 * - CUSTOM_SOURCE_SHADOW=1
 *     optional shadow comparison; never writes shadow leads
 * - GENERIC_SCRAPER_V2_MODE (legacy)
 *     off/live → kernel; shadow → kernel+shadow; rollback_v1 → V1;
 *     invalid → kernel (no longer maps to permanent V1)
 *
 * Planned removal: B4.
 */

export type CustomSourceRuntimeMode = "kernel" | "shadow" | "rollback_v1";

export const CUSTOM_ROUTING_DELETION_GATE =
  "B4 after ≤14 days soak or 3 controlled live custom runs across ≥3 days";

function normalizeMode(raw: string | undefined): CustomSourceRuntimeMode | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "kernel" || value === "production" || value === "live" || value === "off") {
    return value === "off" ? "kernel" : value === "live" || value === "production" ? "kernel" : "kernel";
  }
  if (value === "shadow") return "shadow";
  if (value === "rollback_v1" || value === "v1" || value === "rollback") return "rollback_v1";
  return undefined;
}

export function readCustomSourceRuntimeMode(
  env?: Record<string, string | undefined>,
): CustomSourceRuntimeMode {
  const source = env ?? process.env;

  if (
    ["1", "true", "yes", "on"].includes(
      String(source.CUSTOM_SOURCE_ROLLBACK_V1 ?? "")
        .trim()
        .toLowerCase(),
    )
  ) {
    return "rollback_v1";
  }

  if (
    ["1", "true", "yes", "on"].includes(
      String(source.CUSTOM_SOURCE_SHADOW ?? "")
        .trim()
        .toLowerCase(),
    )
  ) {
    return "shadow";
  }

  const primary =
    normalizeMode(source.CUSTOM_SOURCE_RUNTIME) ??
    normalizeMode(source.CUSTOM_CRAWL_MODE);
  if (primary) return primary;

  const legacy = String(source.GENERIC_SCRAPER_V2_MODE ?? "")
    .trim()
    .toLowerCase();
  if (legacy === "shadow") return "shadow";
  if (legacy === "rollback_v1" || legacy === "v1") return "rollback_v1";
  // off / live / missing / invalid → kernel (B2 accepted default)
  return "kernel";
}

export function isCustomSourceShadowEnabled(
  env?: Record<string, string | undefined>,
): boolean {
  return readCustomSourceRuntimeMode(env) === "shadow";
}

export function isCustomSourceRollbackV1(
  env?: Record<string, string | undefined>,
): boolean {
  return readCustomSourceRuntimeMode(env) === "rollback_v1";
}
