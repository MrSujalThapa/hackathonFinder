/**
 * Canonical discovery crawl profile names.
 * Source-specific numeric budgets stay in native/custom adapters.
 * Do not redefine profile enums in experiments or collectors.
 */
export type { DiscoveryProfile as CrawlProfile } from "@/core/discovery/types";
export { discoveryProfileSchema } from "@/core/discovery/schemas";

export const CRAWL_PROFILE_NAMES = ["light", "standard", "deep", "exhaustive"] as const;

export type CrawlProfileName = (typeof CRAWL_PROFILE_NAMES)[number];

export function isCrawlProfileName(value: string | undefined): value is CrawlProfileName {
  return Boolean(value && (CRAWL_PROFILE_NAMES as readonly string[]).includes(value));
}
