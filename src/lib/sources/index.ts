export {
  HEALTHABLE_SOURCES,
  assertHealthableSource,
  isHealthableSource,
  toSourceName,
  type HealthableSourceName,
  type SourceCapabilities,
  type SourceConnectionLabel,
  type SourceDiscoveryMode,
  type SourceFailureCategory,
  type SourceHealth,
  type SourceHealthStatus,
  type SourceSettingsState,
} from "@/lib/sources/types";

export {
  DEFAULT_SOURCE_ENABLED,
  SOURCE_CAPABILITIES,
  SOURCE_DISPLAY_NAMES,
  defaultEnabledMap,
  discoveryModeFor,
  resolveSourceEnabled,
} from "@/lib/sources/config";

export {
  classifyCollectorResult,
  classifyFailureText,
} from "@/lib/sources/classify";

export {
  DIAGNOSTIC_MAX_RESULTS,
  DIAGNOSTIC_TIMEOUT_MS,
  checkAllSourcesHealth,
  checkSourceHealth,
  listSourceHealthSnapshots,
} from "@/lib/sources/diagnostics";

export {
  getEnabledSources,
  readSourceSettings,
  recordSourceHealth,
  updateSourceEnabled,
  writeSourceSettings,
} from "@/lib/sources/settingsStore";

export { sanitizeDiagnosticMessage } from "@/lib/sources/sanitize";
