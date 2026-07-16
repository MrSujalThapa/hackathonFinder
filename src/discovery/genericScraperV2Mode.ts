import type { CollectorResult } from "@/collectors/types";
import {
  collectCustomSourceViaKernel,
  genericLeadToRawLead,
  isBlockedCustomSourceUrl,
  originVariants,
  readCustomSourceRuntimeMode,
  warnDeprecatedCustomRoutingFlags,
  type CustomSourceRuntimeMode,
} from "@/crawl/adapters/custom";
import type { CustomSource } from "@/server/customSources/types";

/** @deprecated Historical Phase 6.1 label — production always uses kernel. */
export type GenericScraperV2Mode = "live";

export {
  genericLeadToRawLead,
  isBlockedCustomSourceUrl,
  originVariants,
  readCustomSourceRuntimeMode,
  warnDeprecatedCustomRoutingFlags,
};

/**
 * Legacy reader retained for tests/docs compatibility.
 * Always resolves to the kernel path ("live" label).
 */
export function readGenericScraperV2Mode(
  env?: { GENERIC_SCRAPER_V2_MODE?: string | undefined },
): GenericScraperV2Mode {
  warnDeprecatedCustomRoutingFlags(env);
  return "live";
}

/**
 * Collect a configured custom source via DirectoryCrawlKernel.
 * Shadow / V1 rollback routes removed in B4.
 */
export async function collectCustomSourceWithV2Routing(
  source: CustomSource,
  options: {
    mode?: CustomSourceRuntimeMode | GenericScraperV2Mode | "kernel" | "shadow" | "rollback_v1" | "off";
    timeoutMs?: number;
    logger?: (message: string) => void;
    persistHealth?: boolean;
  } = {},
): Promise<CollectorResult> {
  warnDeprecatedCustomRoutingFlags(undefined, options.logger);
  if (options.mode && options.mode !== "kernel" && options.mode !== "live") {
    options.logger?.(
      `[custom:${source.slug}] Ignoring obsolete mode=${options.mode}; using kernel`,
    );
  }
  void readCustomSourceRuntimeMode();
  return collectCustomSourceViaKernel(source, options);
}
