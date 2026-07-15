export type {
  CancelDiscoveryJobResult,
  CreateDiscoveryJobInput,
  CreateDiscoveryJobResult,
  DiscoveryJob,
  DiscoveryJobEvent,
  DiscoveryJobStatus,
  DiscoveryJobSummary,
  GetDiscoveryJobResult,
  ListDiscoveryJobsResult,
  ListSourceHealthResult,
  ParsedTerminalCommand,
  SourceHealth,
  SourceHealthStatus,
  TerminalEventLevel,
  TerminalLine,
  TerminalLineKind,
} from "@/lib/terminal/types";

export {
  ALLOWED_SLASH,
  isActiveJobStatus,
  parseTerminalCommand,
  REJECTION_MESSAGE,
} from "@/lib/terminal/parseCommand";

export {
  cancelDiscoveryJob,
  createDiscoveryJob,
  DiscoveryApiError,
  fetchSourceHealth,
  getDiscoveryJob,
  listDiscoveryJobs,
  streamJobEvents,
} from "@/lib/terminal/api";
