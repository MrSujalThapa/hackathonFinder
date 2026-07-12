export type DiscoveryMode = "online" | "in-person" | "hybrid" | "unknown";

export type SourceName =
  | "hacklist"
  | "hakku"
  | "devpost"
  | "mlh"
  | "luma"
  | "web"
  | "x"
  | "mock";

export type RawLead = {
  id: string;
  source: SourceName;
  title?: string;
  url?: string;
  text?: string;
  links: string[];
  postedAt: string;
  metadata?: Record<string, unknown>;
};

export type HackathonEvidence = {
  type:
    | "official_page"
    | "apply_page"
    | "x_post"
    | "manual_lead"
    | "search_result"
    | "source_card";
  url?: string;
  title?: string;
  snippet?: string;
  raw?: Record<string, unknown>;
};

export type HackathonEvent = {
  name: string;
  source: SourceName;
  officialUrl?: string;
  applyUrl?: string;
  socialUrl?: string;
  startDate?: string;
  endDate?: string;
  deadline?: string;
  location?: string;
  mode?: DiscoveryMode;
  city?: string;
  country?: string;
  prize?: string;
  themes: string[];
  eligibility?: string;
  description?: string;
  sourceIds?: Record<string, unknown>;
  evidence: HackathonEvidence[];
};

export type DiscoveryPreferences = {
  rawCommand: string;
  locations: string[];
  dateFrom?: string;
  dateTo?: string;
  themes: string[];
  modes: DiscoveryMode[];
  sources: SourceName[];
  includeRemote: boolean;
  includeInPerson: boolean;
  maxResults: number;
};

export type ScoringResult = {
  score: number;
  whyMatch: string[];
  redFlags: string[];
  rejected: boolean;
  rejectionReason?: string;
};

export type VerificationResult = {
  valid: boolean;
  confidence: "low" | "medium" | "high";
  status: "accepted" | "rejected" | "needs_review";
  reasons: string[];
  redFlags: string[];
};

export type RejectedCandidate = {
  name: string;
  source: SourceName;
  stage: "verification" | "scoring";
  reason: string;
};

export type AcceptedCandidate = {
  event: HackathonEvent;
  score: ScoringResult;
  fingerprint: string;
  status: "NEW" | "NEEDS_REVIEW";
  classification?: EventPageClassification;
  sourceAuthority?: number;
  deadlineState?: "open" | "closed" | "missing" | "unclear";
  hasOfficialUrl?: boolean;
  hasApplyUrl?: boolean;
};

export type EventPageClassification =
  | "INDIVIDUAL_EVENT"
  | "EVENT_DIRECTORY"
  | "ARTICLE"
  | "ORGANIZATION_PAGE"
  | "HISTORICAL_EVENT"
  | "UNCERTAIN";

export type DiscoveryQualityStats = {
  individualEvents: number;
  directoriesFiltered: number;
  articlesFiltered: number;
  historicalOrExpiredFiltered: number;
  uncertainNeedsReview: number;
  crossSourceMerges: number;
  missingDeadlines: number;
  missingApplyLinks: number;
};

export type XDiscoveryStats = {
  queriesPlanned: number;
  queriesExecuted: number;
  postsReturned: number;
  postsDeduped: number;
  postsWithLinks: number;
  postsKept: number;
  postsRejectedNoise: number;
  pagesEnriched: number;
  durationMs: number;
  rateQuotaWarnings: number;
};

export type AgentRunSummary = {
  rawCommand: string;
  preferences: DiscoveryPreferences;
  dryRun: boolean;
  verbose?: boolean;
  rawLeads: number;
  uniqueLeads: number;
  crossSourceMerges: number;
  enriched: number;
  extracted: number;
  accepted: number;
  rejected: number;
  /** Live: candidates created. Dry-run: always 0. */
  created: number;
  /** Live: candidates updated. Dry-run: always 0. */
  updated: number;
  /** Dry-run only: would-be creates. */
  wouldCreate: number;
  /** Dry-run only: would-be updates. */
  wouldUpdate: number;
  /** Dry-run: evidence rows that would be attached. Live: evidence rows written. */
  evidenceWritten: number;
  wouldAttachEvidence: number;
  storageFailures: number;
  /** @deprecated Prefer created/wouldCreate — kept for agent_runs mapping. */
  stored: number;
  /** @deprecated Prefer updated/wouldUpdate */
  duplicatesUpdated: number;
  needsReview: number;
  durationMs: number;
  quality: DiscoveryQualityStats;
  /** Present when the x source ran. */
  xDiscovery?: XDiscoveryStats;
  acceptedCandidates: Array<{
    name: string;
    score: number;
    location: string;
    deadline: string;
    status: string;
    classification?: EventPageClassification;
    sourceAuthority?: number;
    deadlineState?: string;
    hasOfficialUrl?: boolean;
    hasApplyUrl?: boolean;
  }>;
  rejectedCandidates: RejectedCandidate[];
  sourceStats: SourceRunStats[];
  agent?: AgentRunObservability;
  warnings: string[];
  errors: string[];
};

export type AgentRunObservability = {
  mode: "AGENT" | "DETERMINISTIC";
  provider?: string;
  model?: string;
  llmCalls: number;
  toolCalls: number;
  sourcesSelected: SourceName[];
  stopReason: string;
  fallbackUsed: boolean;
  warnings: string[];
};

export type SourceRunStats = {
  source: SourceName;
  leadsFound: number;
  accepted: number;
  rejected: number;
  errors: string[];
  warnings: string[];
  durationMs: number;
};
