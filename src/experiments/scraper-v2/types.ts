export type StructuredArtifactKind =
  | "next_data"
  | "next_route_data"
  | "graphql"
  | "embedded_json"
  | "json_ld";

export type StructuredArtifact = {
  kind: StructuredArtifactKind;
  label: string;
  sourceUrl: string;
  payload: unknown;
  byteLength: number;
};

export type CandidateArrayDiagnostic = {
  artifact: string;
  artifactKind: StructuredArtifactKind;
  path: string;
  recordCount: number;
  repeatedKeyCoverage: number;
  objectRatio: number;
  uniqueness: number;
  confidence: number;
  probableFields: FieldMapping;
  sampleKeys: string[];
};

export type FieldMapping = {
  title?: string;
  url?: string;
  slug?: string;
  id?: string;
  startDate?: string;
  endDate?: string;
  registrationDeadline?: string;
  location?: string;
  mode?: string;
  description?: string;
  status?: string;
};

export type UrlResolution = {
  raw?: string;
  resolved?: string;
  strategy: "absolute" | "relative" | "slug" | "none" | "rejected_listing";
  confidence: number;
};

export type ShadowLead = {
  sourceId: "custom:devfolio";
  extractionLayer:
    | "next_data"
    | "next_route_data"
    | "graphql"
    | "embedded_json";
  title: string;
  canonicalUrl?: string;
  sourceRecordId?: string;
  startDate?: string;
  endDate?: string;
  registrationDeadline?: string;
  location?: string;
  mode?: string;
  description?: string;
  rawStatus?: string;
  confidence: number;
};

export type ExtractionQuality = {
  structuredRecordCount: number;
  selectedArrayCount: number;
  normalizedLeadCount: number;
  validIndividualEventCount: number;
  obviousNonEventCount: number;
  titleCompleteness: number;
  urlCompleteness: number;
  dateCompleteness: number;
  locationCompleteness: number;
  duplicateRate: number;
  extractionDurationMs: number;
  acquisitionMode: "static" | "browser";
  requestsMade: number;
};

export type DevfolioShadowResult = {
  url: string;
  artifacts: Array<Pick<StructuredArtifact, "kind" | "label" | "byteLength">>;
  candidateArrays: CandidateArrayDiagnostic[];
  selectedArray?: CandidateArrayDiagnostic;
  leads: ShadowLead[];
  quality: ExtractionQuality;
  timings: Record<string, number>;
  persistenceDisabled: true;
};
