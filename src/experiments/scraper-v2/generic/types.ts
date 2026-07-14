export type SourceExperiment = {
  inputUrl: string;
  allowedOrigins: string[];
  maxRequests: number;
  maxPages: number;
  maxPayloadBytes: number;
  browserAllowed: boolean;
  expectedContentCategory?: "public_event_directory";
  expectedMinimumEventCount?: number;
};

export type AcquisitionMode = "static" | "browser";

export type AcquiredArtifactKind =
  | "html"
  | "json_ld"
  | "embedded_json"
  | "next_data"
  | "router_data"
  | "network_json"
  | "rss"
  | "sitemap"
  | "dom_snapshot";

export type AcquiredArtifact = {
  artifactId: string;
  kind: AcquiredArtifactKind;
  sourceUrl: string;
  contentType?: string;
  payload: unknown;
  byteSize: number;
  acquisitionMode: AcquisitionMode;
  timingMs: number;
};

export type AcquisitionDiagnostics = {
  finalUrl: string;
  attemptedLayers: string[];
  skippedLayers: string[];
  requestsMade: number;
  browserPages: number;
  bytesInspected: number;
  blockedReason?: string;
  rssLinks: string[];
  sitemapLinks: string[];
  canonicalUrl?: string;
};

export type FieldCoverage = Record<string, number>;

export type CandidateRecordSet = {
  recordSetId: string;
  artifactId: string;
  artifactKind: AcquiredArtifactKind;
  path: string;
  records: unknown[];
  inspectedRecords: number;
  structuralScore: number;
  eventScore: number;
  fieldCoverage: FieldCoverage;
  duplicateRate: number;
  confidence: number;
  sampleKeys: string[];
  rejectionReasons: string[];
};

export type FieldMapping = {
  path: string;
  confidence: number;
  evidence: string[];
};

export type InferredEventSchema = {
  recordSetId: string;
  title: FieldMapping;
  url?: FieldMapping;
  startDate?: FieldMapping;
  endDate?: FieldMapping;
  deadline?: FieldMapping;
  location?: FieldMapping;
  mode?: FieldMapping;
  description?: FieldMapping;
  status?: FieldMapping;
  sourceRecordId?: FieldMapping;
  confidence: number;
  rejected?: boolean;
  rejectionReasons: string[];
};

export type NormalizedStatus =
  | "open"
  | "upcoming"
  | "ongoing"
  | "past"
  | "closed"
  | "unknown";

export type GenericShadowLead = {
  sourceUrl: string;
  artifactKind: AcquiredArtifactKind;
  title: string;
  canonicalUrl?: string;
  sourceRecordId?: string;
  startDate?: string;
  endDate?: string;
  deadline?: string;
  location?: string;
  mode?: string;
  description?: string;
  rawStatus?: string;
  normalizedStatus: NormalizedStatus;
  statusInference: string;
  confidence: number;
};

export type PaginationInference = {
  method: "none" | "page_number" | "cursor" | "next_link" | "offset";
  confidence: number;
  evidence: string[];
  pageCount: number;
  stopReason: "not_attempted" | "no_signal" | "page_cap" | "repeated_cursor" | "no_growth";
};

export type ExtractionQualityReport = {
  discoveredRecords: number;
  normalizedLeads: number;
  validEventLeads: number;
  obviousNonEvents: number;
  titleCompleteness: number;
  urlCompleteness: number;
  dateCompleteness: number;
  duplicateRate: number;
  estimatedPrecision: number;
  estimatedRecall?: number;
  degradedReasons: string[];
  classification: "healthy" | "usable" | "degraded" | "blocked" | "failed";
};

export type GenericStructuredExtractionResult = {
  inputUrl: string;
  finalUrl: string;
  acquisitionMode: AcquisitionMode;
  artifacts: Array<Pick<AcquiredArtifact, "artifactId" | "kind" | "sourceUrl" | "byteSize" | "acquisitionMode">>;
  acquisition: AcquisitionDiagnostics;
  candidateRecordSets: Array<Omit<CandidateRecordSet, "records"> & { records: number }>;
  selectedRecordSet?: Omit<CandidateRecordSet, "records"> & { records: number };
  schema?: InferredEventSchema;
  leads: GenericShadowLead[];
  pagination: PaginationInference;
  quality: ExtractionQualityReport;
  timings: Record<string, number>;
  counters: {
    arraysScanned: number;
    recordsInspected: number;
    bytesInspected: number;
  };
  persistenceDisabled: true;
};
