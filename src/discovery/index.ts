export {
  createEventEmitter,
  createStdoutEventSink,
  formatDiscoveryEventForCli,
  sanitizeEventMetadata,
  DISCOVERY_EVENT_TYPES,
  type DiscoveryEvent,
  type DiscoveryEventLevel,
  type DiscoveryEventSink,
  type DiscoveryEventType,
} from "@/discovery/events";
export {
  runDiscovery,
  type DiscoveryRunMode,
  type DiscoveryRunResult,
  type RunDiscoveryInput,
} from "@/discovery/runDiscovery";
export {
  executeDiscoveryPipeline,
  isDiscoveryCancelledError,
  type DiscoveryPipelineOptions,
} from "@/discovery/pipeline";
export {
  selectDiscoverySources,
  assertApiSourcesAllowlisted,
  DISCOVERY_DEFAULT_SOURCES,
  DISCOVERY_API_SOURCE_ALLOWLIST,
  type SelectSourcesInput,
  type SourceAvailability,
  type SourceHealthHint,
  type SourceSelectionResult,
} from "@/discovery/selectSources";
export {
  getHakkuConnectionStatus,
  registerHakkuStatusProvider,
  setHakkuStatusProviderForTests,
  type HakkuConnectionStatus,
  type HakkuStatusProvider,
} from "@/discovery/hakkuStatus";
export {
  readDiscoveryRuntimeConfig,
  assertLocalExecutionAllowed,
  createJobBodySchema,
  type CreateJobBody,
  type DiscoveryExecutionMode,
  type DiscoveryRuntimeConfig,
} from "@/discovery/config";
