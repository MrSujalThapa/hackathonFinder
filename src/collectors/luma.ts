import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";

/**
 * Placeholder until Phase 7.3 lands the full Luma collector.
 * Registered so CLI --sources=luma and defaults resolve without crashing.
 */
export const lumaCollector: Collector = {
  source: "luma",
  async collect(_input: CollectorInput): Promise<CollectorResult> {
    const startedAt = Date.now();
    const result = emptyCollectorResult("luma", startedAt);
    result.warnings.push("Luma collector is not fully implemented yet");
    result.durationMs = Date.now() - startedAt;
    return result;
  },
};
