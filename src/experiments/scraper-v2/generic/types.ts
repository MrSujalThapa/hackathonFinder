export type SourceExperiment = {
  inputUrl: string;
  allowedOrigins: string[];
  maxRequests: number;
  maxPages: number;
  maxBrowserActions?: number;
  maxPayloadBytes: number;
  browserAllowed: boolean;
  expectedContentCategory?: "public_event_directory";
  expectedMinimumEventCount?: number;
};

export type CrawlIntentInput = {
  query: string;
  requestedCount?: number;
  dateHorizonStart?: string;
  dateHorizonEnd?: string;
  latencyPreference?: "fast" | "balanced" | "coverage";
};

export type CrawlIntent = {
  normalizedQuery: string;
  targetCountHint?: number;
  dateHorizonStart?: string;
  dateHorizonEnd?: string;
  prioritizeLatency: boolean;
  prioritizeCoverage: boolean;
};

export type DiscoveryBudget = {
  profile: "quick" | "standard" | "deep" | "exhaustive";
  targetAcceptedEvents: number;
  maxRawRecords: number;
  maxSources: number;
  maxPagesPerSource: number;
  maxRequestsPerSource: number;
  maxDetailPagesPerSource: number;
  maxDurationMs: number;
  dateHorizonStart?: string;
  dateHorizonEnd?: string;
  prioritizeLatency: boolean;
  prioritizeCoverage: boolean;
};

export type CrawlProfile = "light" | "standard" | "deep" | "exhaustive";

export type CrawlPlan = {
  profile: CrawlProfile;
  targetValidEvents: number;
  maxRawRecords: number;
  maxSources: number;
  maxPagesPerSource: number;
  maxRequestsPerSource: number;
  maxBrowserActionsPerSource: number;
  maxDetailPagesPerSource: number;
  maxDurationMs: number;
  dateHorizonStart?: string;
  dateHorizonEnd?: string;
  prioritizeLatency: boolean;
  prioritizeCoverage: boolean;
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

export type DomNodeSummary = {
  nodeId: number;
  parentId?: number;
  tag: string;
  role?: string;
  depth: number;
  childCount: number;
  classShape: string;
  textSample?: string;
  textLength: number;
  headingText?: string;
  anchorCount: number;
  imageCount: number;
  dateLikeCount: number;
  locationLikeCount: number;
  urlPattern?: string;
  siblingIndex: number;
  visible: boolean;
  structuralFingerprint: string;
  hrefs: string[];
  childIds: number[];
};

export type DomRepresentation = {
  sourceUrl: string;
  artifactId: string;
  nodeCount: number;
  maxDepth: number;
  nodes: DomNodeSummary[];
};

export type RepeatedUnitSet = {
  unitSetId: string;
  artifactId: string;
  parentNodeId: number;
  unitNodeIds: number[];
  structuralScore: number;
  fieldDensityScore: number;
  layoutScore: number;
  confidence: number;
  rejectionReasons: string[];
  diagnostics: {
    unitCount: number;
    averageTextLength: number;
    uniqueTitleRatio: number;
    uniqueUrlRatio: number;
    dateCoverage: number;
    locationCoverage: number;
    anchorCoverage: number;
    depth: number;
  };
};

export type RelativeFieldSelector = {
  relation: "self" | "heading" | "anchor" | "text" | "image_alt";
  tag?: string;
  confidence: number;
  evidence: string[];
};

export type DomExtractionSchema = {
  version: number;
  pageFingerprint: string;
  recordContainer: {
    parentFingerprint: string;
    unitFingerprint: string;
    unitTag: string;
    unitClassShape: string;
  };
  fields: {
    title: RelativeFieldSelector;
    url?: RelativeFieldSelector;
    startDate?: RelativeFieldSelector;
    endDate?: RelativeFieldSelector;
    location?: RelativeFieldSelector;
    mode?: RelativeFieldSelector;
    description?: RelativeFieldSelector;
  };
  pagination?: PaginationInference;
  confidence: number;
  validationMetrics: {
    testedRecords: number;
    validRecords: number;
    titleCompleteness: number;
    identityCompleteness: number;
    duplicateRate: number;
  };
};

export type DomExtractionResult = {
  strategy: "dom";
  representations: Array<Pick<DomRepresentation, "artifactId" | "nodeCount" | "maxDepth">>;
  repeatedUnitSets: RepeatedUnitSet[];
  selectedUnitSet?: RepeatedUnitSet;
  schema?: DomExtractionSchema;
  leads: GenericShadowLead[];
  availableRecords?: number;
  stopReason: "not_attempted" | "no_dom_artifact" | "no_unit_set" | "schema_rejected" | "page_cap" | "no_growth" | "completed";
  timings: Record<string, number>;
};

export type AcquisitionDiagnostics = {
  requestedUrl?: string;
  finalUrl: string;
  httpStatus?: number;
  attemptedLayers: string[];
  skippedLayers: string[];
  requestsMade: number;
  pagesRequested?: number;
  paginationExecuted?: boolean;
  paginationStopReason?: "not_attempted" | "no_page_param" | "page_cap" | "request_cap" | "no_growth" | "fetch_failed";
  browserPages: number;
  bytesInspected: number;
  blockedReason?: string;
  rssLinks: string[];
  sitemapLinks: string[];
  canonicalUrl?: string;
  runtime?: "custom" | "crawlee";
  queueRequestsAdded?: number;
  queueDuplicateRequests?: number;
  retriesAttempted?: number;
  browserEscalated?: boolean;
  actionsDiscovered?: number;
  actionsExecuted?: number;
  identitiesAfterActions?: number[];
  identityGrowthAfterActions?: number[];
  actionTrace?: Array<{
    actionId: string;
    effect: CandidateAction["proposedEffect"];
    accepted: boolean;
    newIdentityCount: number;
    rejectedReasons: string[];
  }>;
  scrollTrace?: Array<{
    attempt: number;
    accepted: boolean;
    identityCount: number;
    newIdentityCount: number;
    cardCount: number;
    scrollTop: number;
    scrollHeight: number;
    loadingDetected: boolean;
    fingerprintChanged: boolean;
    rejectedReasons: string[];
  }>;
  browserObservation?: {
    listenersAttachedBeforeNavigation: boolean;
    initialDocumentUrl?: string;
    finalRenderedUrl?: string;
    domSamples: Array<{
      label: string;
      nodeCount: number;
      textLength: number;
      eventWordCount: number;
      scrollContainerCount: number;
    }>;
    networkJsonResponses: number;
    frameworkHydrationDetected: boolean;
    nestedScrollContainers: number;
    iframes: number;
    openShadowRoots: number;
    loadingOverlayDetected: boolean;
    blockedState?: string;
  };
  checkpointSaved?: boolean;
  checkpointLoaded?: boolean;
};

export type CrawlRuntimeName = "custom" | "crawlee";

export type CrawlRuntimeInput = {
  experiment: SourceExperiment;
  budget?: DiscoveryBudget;
  signal?: AbortSignal;
  checkpointDir?: string;
  staticArtifactsSufficient: (artifacts: AcquiredArtifact[]) => boolean;
};

export type CrawlRuntimeResult = {
  runtime: CrawlRuntimeName;
  artifacts: AcquiredArtifact[];
  diagnostics: AcquisitionDiagnostics;
};

export type CrawlRuntime = {
  readonly name: CrawlRuntimeName;
  crawl(input: CrawlRuntimeInput): Promise<CrawlRuntimeResult>;
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

export type EventIntentClassification = "healthy" | "usable" | "ambiguous" | "rejected";

export type EventIntentValidation = {
  recordSetId: string;
  eventIntentScore: number;
  identityScore: number;
  schemaTrustScore: number;
  classification: EventIntentClassification;
  reasons: string[];
  metrics: {
    inspectedRecords: number;
    uniqueTitleRatio: number;
    uniqueUrlRatio: number;
    stableIdentityRatio: number;
    dateSignalRatio: number;
    genericTitleRatio: number;
    listingUrlReuseRatio: number;
  };
};

export type DateCoverageSummary = {
  earliestEventDate?: string;
  latestEventDate?: string;
  earliestDeadline?: string;
  latestDeadline?: string;
  openRegistrationRate: number;
  expiredOrClosedRate: number;
  inHorizonEvents: number;
  validEvents: number;
  rawRecords: number;
  dateProgression: "forward" | "backward" | "flat" | "unknown";
  horizonCovered: boolean;
};

export type CandidateAction = {
  elementId: string;
  role?: string;
  accessibleName?: string;
  href?: string;
  disabled: boolean;
  context: "pagination" | "listing" | "filter" | "detail" | "navigation" | "unknown";
  proposedEffect:
    | "next_page"
    | "load_more"
    | "infinite_scroll"
    | "change_sort"
    | "change_filter"
    | "open_detail"
    | "unknown";
  confidence: number;
};

export type ClassifiedFailure = {
  stage: string;
  classification:
    | "timeout"
    | "rate_limited"
    | "blocked"
    | "network_transient"
    | "unsafe_redirect"
    | "payload_too_large"
    | "schema_rejected"
    | "low_precision"
    | "cancelled"
    | "unknown";
  message: string;
  retryable: boolean;
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
  estimatedAvailableRecords?: number;
  availableEstimateMethod?: "api_total" | "visible_count" | "pagination_derived" | "inferred" | "unknown";
  availableEstimateConfidence?: "authoritative" | "strong" | "inferred" | "unknown";
  availableEstimateEvidence: string[];
  availableEstimateContradictions: string[];
  estimatedRecall?: number;
  degradedReasons: string[];
  classification:
    | "healthy"
    | "usable"
    | "degraded"
    | "blocked"
    | "failed"
    | "healthy_complete"
    | "healthy_bounded"
    | "usable_partial"
    | "degraded_under_extraction"
    | "degraded_low_precision"
    | "blocked_human_verification"
    | "blocked_authentication"
    | "stale_or_missing_route"
    | "acquisition_failed"
    | "extraction_failed"
    | "unsafe";
};

export type GenericStructuredExtractionResult = {
  inputUrl: string;
  finalUrl: string;
  acquisitionMode: AcquisitionMode;
  artifacts: Array<Pick<AcquiredArtifact, "artifactId" | "kind" | "sourceUrl" | "byteSize" | "acquisitionMode">>;
  acquisition: AcquisitionDiagnostics;
  candidateRecordSets: Array<Omit<CandidateRecordSet, "records"> & { records: number }>;
  selectedRecordSet?: Omit<CandidateRecordSet, "records"> & { records: number };
  eventIntentValidations: EventIntentValidation[];
  schema?: InferredEventSchema;
  leads: GenericShadowLead[];
  strategySelected: "structured" | "dom" | "none";
  dom?: DomExtractionResult;
  aiAssistance?: {
    invoked: boolean;
    accepted: boolean;
    provider?: string;
    model?: string;
    latencyMs?: number;
    tokenEstimate?: number;
    selectedGroupId?: string;
    classification?: string;
    selectedActionId?: string;
    candidateGroups: number;
    rejectedReasons: string[];
  };
  visionAssistance?: {
    invoked: boolean;
    accepted: boolean;
    provider?: string;
    model?: string;
    latencyMs?: number;
    selectedGroupId?: string;
    selectedGroupIds?: string[];
    mappedDomNodes: number;
    rejectedReasons: string[];
  };
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
