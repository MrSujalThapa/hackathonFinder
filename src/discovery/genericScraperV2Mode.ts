import type { CollectorResult } from "@/collectors/types";
import { collectCustomSource } from "@/collectors/customSource";
import {
  collectCustomSourceViaKernel,
  genericLeadToRawLead,
  isBlockedCustomSourceUrl,
  isCustomSourceRollbackV1,
  originVariants,
  readCustomSourceRuntimeMode,
  type CustomSourceRuntimeMode,
} from "@/crawl/adapters/custom";
import type { CustomSource } from "@/server/customSources/types";

/** @deprecated Use CustomSourceRuntimeMode — kept for Phase 6.1 test compatibility. */
export type GenericScraperV2Mode = "off" | "shadow" | "live" | "rollback_v1";

export {
  genericLeadToRawLead,
  isBlockedCustomSourceUrl,
  originVariants,
  readCustomSourceRuntimeMode,
};

/**
 * Legacy reader: maps GENERIC_SCRAPER_V2_MODE onto B2 runtime modes.
 * Invalid/missing/off/live → kernel. shadow → shadow. rollback_v1 → V1.
 * `off` no longer means permanent weak V1.
 */
export function readGenericScraperV2Mode(
  env?: { GENERIC_SCRAPER_V2_MODE?: string | undefined },
): GenericScraperV2Mode {
  const mode = readCustomSourceRuntimeMode(env);
  if (mode === "shadow") return "shadow";
  if (mode === "rollback_v1") return "rollback_v1";
  return "live"; // kernel path; "off" historically meant V1 — now kernel
}

export function customSourceToExperiment(source: CustomSource) {
  let origin = source.listingUrl;
  try {
    origin = new URL(source.listingUrl).origin;
  } catch {
    // keep listing URL
  }
  const isHackathonsSpace = /hackathons\.space/i.test(source.listingUrl);
  return {
    inputUrl: source.listingUrl,
    allowedOrigins: originVariants(origin),
    maxRequests: Math.max(8, Math.min(40, source.maxItems)),
    maxPages: isHackathonsSpace
      ? 3
      : Math.max(3, Math.min(20, Math.ceil(source.maxItems / 10))),
    maxBrowserActions: isHackathonsSpace ? 3 : 8,
    maxPayloadBytes: 5_000_000,
    browserAllowed: source.mode !== "static",
    expectedContentCategory: "public_event_directory" as const,
    expectedMinimumEventCount: isHackathonsSpace ? 20 : undefined,
  };
}

async function runShadowComparison(
  source: CustomSource,
  kernelResult: CollectorResult,
  options: {
    timeoutMs?: number;
    logger?: (message: string) => void;
  },
): Promise<CollectorResult> {
  // Shadow-only: dynamic import keeps experiment runtime out of the normal graph.
  try {
    const { inferDiscoveryBudget } = await import("@/experiments/scraper-v2/generic/budget");
    const { runGenericStructuredExtraction } = await import(
      "@/experiments/scraper-v2/generic/structuredExtraction"
    );
    const experiment = customSourceToExperiment(source);
    const budget = inferDiscoveryBudget({
      query: "standard public hackathon directory coverage",
    });
    const extraction = await runGenericStructuredExtraction(experiment, { budget });
    options.logger?.(
      `[custom:${source.slug}] shadow experiment valid=${extraction.quality.validEventLeads} writes=0`,
    );
    kernelResult.warnings.push(
      "custom_runtime=shadow",
      "custom_shadow_writes=0",
      `shadow_classification=${extraction.quality.classification}`,
      `shadow_valid=${extraction.quality.validEventLeads}`,
    );
    kernelResult.metrics = {
      ...(kernelResult.metrics ?? {}),
      shadowValid: extraction.quality.validEventLeads,
      shadowWrites: 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "shadow failed";
    kernelResult.warnings.push(`custom_shadow_error=${message}`, "custom_shadow_writes=0");
  }
  return kernelResult;
}

/**
 * Collect a configured custom source.
 * B2 default: shared DirectoryCrawlKernel via custom directory adapter.
 * Emergency V1 only when CUSTOM_SOURCE_ROLLBACK_V1 / mode=rollback_v1.
 * Shadow never writes comparison leads.
 */
export async function collectCustomSourceWithV2Routing(
  source: CustomSource,
  options: {
    mode?: CustomSourceRuntimeMode | GenericScraperV2Mode;
    timeoutMs?: number;
    logger?: (message: string) => void;
    persistHealth?: boolean;
  } = {},
): Promise<CollectorResult> {
  const mode: CustomSourceRuntimeMode = (() => {
    if (options.mode === "rollback_v1" || options.mode === "off") {
      // Explicit "off" in options was historical V1; B2 treats bare off as kernel
      // unless rollback flag is set. Prefer explicit rollback.
      if (options.mode === "rollback_v1") return "rollback_v1";
      return readCustomSourceRuntimeMode();
    }
    if (options.mode === "shadow") return "shadow";
    if (options.mode === "live" || options.mode === "kernel") return "kernel";
    return readCustomSourceRuntimeMode();
  })();

  if (isBlockedCustomSourceUrl(source.listingUrl)) {
    return collectCustomSourceViaKernel(source, options);
  }

  if (mode === "rollback_v1" || isCustomSourceRollbackV1()) {
    options.logger?.(
      `[custom:${source.slug}] EMERGENCY rollback_v1 — logged; soak gate ≤14 days / B4 delete`,
    );
    const v1 = await collectCustomSource(source, {
      timeoutMs: options.timeoutMs,
      logger: options.logger,
      persistHealth: options.persistHealth,
    });
    v1.warnings.push(
      "custom_runtime=rollback_v1",
      "custom_rollback_logged=1",
      "custom_rollback_gate=B4",
    );
    return v1;
  }

  const kernel = await collectCustomSourceViaKernel(source, options);

  if (mode === "shadow") {
    return runShadowComparison(source, kernel, options);
  }

  return kernel;
}
