/**
 * Production crawl kernel contracts (B1).
 * Source-agnostic — no Devpost/Luma/discovery scoring imports.
 */

export const CRAWL_KERNEL_VERSION = "b1-kernel-1";

export type CrawlMechanism = "api" | "scroll" | "next" | "static";

export type CrawlStopReason =
  | "exhausted"
  | "no_growth"
  | "target_reached"
  | "maximum_cards_reached"
  | "max_budget"
  | "timeout"
  | "blocked_human_verification"
  | "blocked_authentication"
  | "cancelled"
  | "acquisition_failed";

export type CrawlSourceState =
  | "healthy_complete"
  | "healthy_bounded"
  | "usable_partial"
  | "degraded"
  | "acquisition_failed"
  | "blocked_human_verification"
  | "blocked_authentication";

export type InventoryEstimateMethod =
  | "api_total"
  | "pagination_derived"
  | "scroll_plateau"
  | "unknown";

export type InventoryEstimate = {
  value: number;
  method: InventoryEstimateMethod;
  confidence: "strong" | "moderate" | "weak";
};

export type SourceInventoryMetrics = {
  observed?: InventoryEstimate;
  collectedRaw: number;
  collectedUnique: number;
};

export type ListingEvidence = {
  displayedDateText?: string;
  locationText?: string;
  organizerText?: string;
  categoryTexts?: string[];
  shortDescription?: string;
  sourceRecordId?: string;
};

export type ListingCard = {
  identity: string;
  title: string;
  url?: string;
  startDate?: string;
  endDate?: string;
  modeHint?: "remote" | "in_person" | "hybrid" | "unknown";
  evidence?: ListingEvidence;
};

export type CrawlBudget = {
  maxDurationMs: number;
  maxRequests: number;
  maxPagesOrScrolls: number;
  maxBrowserActions: number;
  maxPayloadBytes: number;
  /** Soft product target — stop with target_reached when stopAtTarget is true. */
  targetUnique?: number;
  stopAtTarget?: boolean;
  /** Hard unique-card ceiling — stop with maximum_cards_reached. */
  maxUnique?: number;
  minReservedUnits?: number;
  maxExtensionUnits?: number;
};

export type GrowthStepResult = {
  cards: ListingCard[];
  requestsUsed: number;
  pagesOrScrollsUsed: number;
  actionsUsed: number;
  grew: boolean;
  duplicateRate: number;
  done: boolean;
  stopHint?: CrawlStopReason;
};

export type DirectoryAdapter<TSession> = {
  readonly id: string;
  readonly version: string;

  acquire(input: {
    url: string;
    budget: CrawlBudget;
    signal?: AbortSignal;
  }): Promise<{
    mechanism: CrawlMechanism;
    requestedUrl: string;
    finalUrl: string;
    session: TSession;
  }>;

  grow(input: {
    session: TSession;
    budgetRemaining: CrawlBudget;
    seen: ReadonlySet<string>;
    signal?: AbortSignal;
  }): Promise<GrowthStepResult>;

  release?(session: TSession): Promise<void>;
};

export type CompactCrawlProgressEvent = {
  type: "acquired" | "grew" | "stopped";
  unique: number;
  pagesOrScrolls: number;
  stopReason?: CrawlStopReason;
};

export type DirectoryCrawlResult = {
  mechanism: CrawlMechanism;
  requestedUrl: string;
  finalUrl: string;
  cards: ListingCard[];
  inventory: SourceInventoryMetrics;
  stopReason: CrawlStopReason;
  sourceState: CrawlSourceState;
  pagesOrScrolls: number;
  requests: number;
  actions: number;
  listingDurationMs: number;
  kernelVersion: string;
  adapterId: string;
  adapterVersion: string;
  targetReached: boolean;
  cancelled: boolean;
};
