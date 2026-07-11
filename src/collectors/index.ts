export type { Collector, CollectorInput, CollectorResult } from "@/collectors/types";
export {
  DEFAULT_COLLECTOR_TIMEOUT_MS,
  REAL_DEFAULT_SOURCES,
  emptyCollectorResult,
} from "@/collectors/types";
export {
  getCollector,
  getRegisteredSources,
  parseSourcesFlag,
  resolveCollectors,
  runCollectors,
} from "@/collectors/registry";
