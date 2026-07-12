import type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
import { emptyCollectorResult } from "@/collectors/types";
import { hasXConfig } from "@/config/env";

/**
 * X MCP collector skeleton (Phase 8.1).
 * Full MCP search lands in later Phase 8 steps. Missing config must warn, not fail.
 */
export const xMcpCollector: Collector = {
  source: "x",

  async collect(_input: CollectorInput): Promise<CollectorResult> {
    const startedAt = Date.now();
    const result = emptyCollectorResult("x", startedAt);

    if (!hasXConfig()) {
      result.warnings.push(
        "X MCP not configured (set X_BEARER_TOKEN and X_MCP_URL); skipping x discovery.",
      );
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    result.warnings.push(
      "X MCP collector registered but search not yet implemented; skipping.",
    );
    result.durationMs = Date.now() - startedAt;
    return result;
  },
};
