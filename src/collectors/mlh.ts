import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";

/**
 * Placeholder until Phase 7.2 lands the full MLH event collector.
 * Registered so CLI --sources=mlh and defaults resolve without crashing.
 */
export const mlhCollector: Collector = {
  source: "mlh",
  async collect(_input: CollectorInput): Promise<CollectorResult> {
    const startedAt = Date.now();
    const result = emptyCollectorResult("mlh", startedAt);
    result.warnings.push("MLH collector is not fully implemented yet");
    result.durationMs = Date.now() - startedAt;
    return result;
  },
};
