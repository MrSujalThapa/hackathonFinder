import type { DiscoveryPreferences, DiscoverySourceId, RawLead, SourceName } from "@/core/discovery/types";

export type CollectorInput = {
  preferences: DiscoveryPreferences;
  maxResults: number;
  timeoutMs: number;
  dryRun: boolean;
  requestId?: string;
  logger?: (message: string) => void;
};

export type CollectorStatus = "completed" | "degraded" | "failed" | "auth_required";

export type CollectorDiagnostics = {
  discovered: number;
  returned: number;
  enriched: number;
  partial: number;
  dropped: number;
  detectedUnits?: number;
  candidateUnits?: number;
  normalizedLeads?: number;
  rejectedDuringParsing?: number;
  pagesTraversed?: number;
  extractionStrategy?: string;
  stopReason?: string;
  safeMessage?: string;
};

export type CollectorResult = {
  source: DiscoverySourceId;
  leads: RawLead[];
  status: CollectorStatus;
  diagnostics: CollectorDiagnostics;
  errors: string[];
  warnings: string[];
  durationMs: number;
  /** Optional collector-specific counters for run summaries. */
  metrics?: Record<string, number>;
};

export type Collector = {
  source: SourceName;
  collect: (input: CollectorInput) => Promise<CollectorResult>;
};

export const DEFAULT_COLLECTOR_TIMEOUT_MS = 15_000;

/** Default live sources after Phase 7 broader discovery. */
export const REAL_DEFAULT_SOURCES: SourceName[] = ["hacklist", "mlh", "luma", "web"];

export function emptyCollectorResult(source: DiscoverySourceId, startedAt = Date.now()): CollectorResult {
  return {
    source,
    leads: [],
    status: "completed",
    diagnostics: {
      discovered: 0,
      returned: 0,
      enriched: 0,
      partial: 0,
      dropped: 0,
    },
    errors: [],
    warnings: [],
    durationMs: Date.now() - startedAt,
  };
}
