import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";

/**
 * Placeholder until Phase 7.6 lands the full web-search collector.
 * Registered so CLI --sources=web and defaults resolve without crashing.
 */
export const webSearchCollector: Collector = {
  source: "web",
  async collect(_input: CollectorInput): Promise<CollectorResult> {
    const startedAt = Date.now();
    const result = emptyCollectorResult("web", startedAt);
    result.warnings.push("Web search collector is not fully implemented yet");
    result.durationMs = Date.now() - startedAt;
    return result;
  },
};
