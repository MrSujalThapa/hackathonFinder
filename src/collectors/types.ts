import type { DiscoveryPreferences, RawLead, SourceName } from "@/core/discovery/types";

export type CollectorInput = {
  preferences: DiscoveryPreferences;
  maxResults: number;
  timeoutMs: number;
  dryRun: boolean;
  requestId?: string;
  logger?: (message: string) => void;
};

export type CollectorResult = {
  source: SourceName;
  leads: RawLead[];
  errors: string[];
  warnings: string[];
  durationMs: number;
};

export type Collector = {
  source: SourceName;
  collect: (input: CollectorInput) => Promise<CollectorResult>;
};

export const DEFAULT_COLLECTOR_TIMEOUT_MS = 15_000;

export const REAL_DEFAULT_SOURCES: SourceName[] = ["hacklist", "devpost", "hakku"];

export function emptyCollectorResult(source: SourceName, startedAt = Date.now()): CollectorResult {
  return {
    source,
    leads: [],
    errors: [],
    warnings: [],
    durationMs: Date.now() - startedAt,
  };
}
