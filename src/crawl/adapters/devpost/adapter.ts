/**
 * Devpost full-directory API adapter for DirectoryCrawlKernel.
 * Owns page/cursor coordination and identity mapping.
 * Source-specific HTTP/JSON parsing stays in the collector via injected fetchPage.
 */
import type { RawLead } from "@/core/discovery/types";
import { normalizeUrlForDedupe } from "@/lib/http/url";
import type {
  CrawlBudget,
  CrawlMechanism,
  CrawlStopReason,
  DirectoryAdapter,
  GrowthStepResult,
  ListingCard,
} from "@/crawl/types";

export const DEVPOST_ADAPTER_ID = "devpost-directory-api";
export const DEVPOST_ADAPTER_VERSION = "b3-1";
export const DEVPOST_PAGE_CONCURRENCY = 3;

export type DevpostAcquisitionScope = "full_directory_api" | "open_upcoming_api_subset";

export type DevpostApiPageSnapshot = {
  requestedPage: number;
  requestedUrl: string;
  finalUrl: string;
  leads: RawLead[];
  cardCount: number;
  fingerprint: string;
  firstUrls: string[];
  lastUrls: string[];
  hasNext: boolean;
  nextPage?: number;
  status: "completed" | "failed" | "degraded";
  stopReason?: string;
  error?: string;
  metaTotalCount?: number;
};

export type DevpostFetchPage = (
  pageNumber: number,
  maxResults: number,
  timeoutMs: number,
  scope: DevpostAcquisitionScope,
) => Promise<DevpostApiPageSnapshot>;

export type DevpostDirectorySession = {
  scope: DevpostAcquisitionScope;
  nextPage: number;
  maxPages: number;
  concurrency: number;
  startedAt: number;
  timeoutMs: number;
  pendingCards: ListingCard[];
  initialPageCounted: boolean;
  leadsByIdentity: Map<string, RawLead>;
  pages: DevpostApiPageSnapshot[];
  seenFingerprints: Map<string, number>;
  statusCounts: Record<string, number>;
  metaTotalCount: number | null;
  duplicateUrls: number;
  repeatedPages: number;
  adapterStopDetail?: string;
  acquisitionFailed: boolean;
  exhausted: boolean;
  logger?: (message: string) => void;
  fetchPage: DevpostFetchPage;
  classifyOpenState: (status: string | undefined) => "open" | "upcoming" | "ended" | "unknown";
};

function leadIdentity(lead: RawLead): string {
  return lead.url ? normalizeUrlForDedupe(lead.url) : lead.id;
}

function leadToCard(lead: RawLead): ListingCard {
  return {
    identity: leadIdentity(lead),
    title: lead.title ?? "",
    url: lead.url,
    startDate:
      typeof lead.metadata?.startDate === "string" ? lead.metadata.startDate : undefined,
    endDate: typeof lead.metadata?.endDate === "string" ? lead.metadata.endDate : undefined,
    modeHint:
      lead.metadata?.mode === "online"
        ? "remote"
        : lead.metadata?.mode === "in-person"
          ? "in_person"
          : lead.metadata?.mode === "hybrid"
            ? "hybrid"
            : "unknown",
    evidence: {
      displayedDateText:
        typeof lead.metadata?.dateText === "string" ? lead.metadata.dateText : undefined,
      locationText:
        typeof lead.metadata?.location === "string" ? lead.metadata.location : undefined,
      organizerText:
        typeof lead.metadata?.organizer === "string" ? lead.metadata.organizer : undefined,
      shortDescription: lead.text,
      sourceRecordId:
        typeof lead.metadata?.sourceIds === "object" &&
        lead.metadata.sourceIds &&
        typeof (lead.metadata.sourceIds as { devpost?: string }).devpost === "string"
          ? (lead.metadata.sourceIds as { devpost: string }).devpost
          : undefined,
    },
  };
}

function emptyStep(opts: {
  done?: boolean;
  stopHint?: CrawlStopReason;
  requestsUsed?: number;
  pagesOrScrollsUsed?: number;
}): GrowthStepResult {
  return {
    cards: [],
    requestsUsed: opts.requestsUsed ?? 0,
    pagesOrScrollsUsed: opts.pagesOrScrollsUsed ?? 0,
    actionsUsed: 0,
    grew: false,
    duplicateRate: 0,
    done: Boolean(opts.done),
    ...(opts.stopHint ? { stopHint: opts.stopHint } : {}),
  };
}

export class DevpostDirectoryAdapter implements DirectoryAdapter<DevpostDirectorySession> {
  readonly id = DEVPOST_ADAPTER_ID;
  readonly version = DEVPOST_ADAPTER_VERSION;
  lastSession: DevpostDirectorySession | undefined;

  constructor(
    private readonly options: {
      scope?: DevpostAcquisitionScope;
      maxPages: number;
      timeoutMs: number;
      concurrency?: number;
      fetchPage: DevpostFetchPage;
      classifyOpenState: DevpostDirectorySession["classifyOpenState"];
      logger?: (message: string) => void;
    },
  ) {}

  async acquire(input: {
    url: string;
    budget: CrawlBudget;
    signal?: AbortSignal;
  }): Promise<{
    mechanism: CrawlMechanism;
    requestedUrl: string;
    finalUrl: string;
    session: DevpostDirectorySession;
  }> {
    if (input.signal?.aborted) {
      const error = new Error("Crawl cancelled");
      error.name = "AbortError";
      throw error;
    }

    const scope = this.options.scope ?? "full_directory_api";
    const concurrency = Math.max(1, this.options.concurrency ?? DEVPOST_PAGE_CONCURRENCY);
    const session: DevpostDirectorySession = {
      scope,
      nextPage: 1,
      maxPages: this.options.maxPages,
      concurrency,
      startedAt: Date.now(),
      timeoutMs: this.options.timeoutMs,
      pendingCards: [],
      initialPageCounted: false,
      leadsByIdentity: new Map(),
      pages: [],
      seenFingerprints: new Map(),
      statusCounts: { open: 0, upcoming: 0, ended: 0, unknown: 0 },
      metaTotalCount: null,
      duplicateUrls: 0,
      repeatedPages: 0,
      acquisitionFailed: false,
      exhausted: false,
      logger: this.options.logger,
      fetchPage: this.options.fetchPage,
      classifyOpenState: this.options.classifyOpenState,
    };

    session.logger?.(
      scope === "open_upcoming_api_subset"
        ? "Fetching open+upcoming API subset page 1..."
        : "Fetching full-directory API page 1 (unfiltered /api/hackathons)...",
    );

    const remaining = Math.max(
      1_000,
      this.options.timeoutMs - (Date.now() - session.startedAt),
    );
    const first = await this.options.fetchPage(1, input.budget.maxUnique ?? 10_000, remaining, scope);
    session.pendingCards = this.mergePage(session, first);
    session.nextPage = 2;

    if (first.status === "failed") {
      session.acquisitionFailed = true;
      session.adapterStopDetail = "api_page_failed";
    } else if (!first.hasNext) {
      session.exhausted = true;
      session.adapterStopDetail = "no_next_page";
    }

    this.lastSession = session;
    return {
      mechanism: "api",
      requestedUrl: first.requestedUrl || input.url,
      finalUrl: first.finalUrl || first.requestedUrl || input.url,
      session,
    };
  }

  async grow(input: {
    session: DevpostDirectorySession;
    budgetRemaining: CrawlBudget;
    seen: ReadonlySet<string>;
    signal?: AbortSignal;
  }): Promise<GrowthStepResult> {
    const { session } = input;
    if (input.signal?.aborted) {
      const error = new Error("Crawl cancelled");
      error.name = "AbortError";
      throw error;
    }

    if (session.acquisitionFailed) {
      return emptyStep({ done: true, stopHint: "acquisition_failed" });
    }

    if (session.pendingCards.length > 0) {
      const cards = session.pendingCards;
      session.pendingCards = [];
      const pagesOrScrollsUsed = session.initialPageCounted ? 0 : 1;
      session.initialPageCounted = true;
      const unseen = cards.filter((card) => !input.seen.has(card.identity));
      const stopAfterEmit = session.exhausted;
      return {
        cards,
        requestsUsed: 0,
        pagesOrScrollsUsed,
        actionsUsed: 0,
        grew: unseen.length > 0,
        duplicateRate: cards.length > 0 ? (cards.length - unseen.length) / cards.length : 0,
        done: stopAfterEmit,
        ...(stopAfterEmit ? { stopHint: "exhausted" as const } : {}),
      };
    }

    if (session.exhausted) {
      return emptyStep({ done: true, stopHint: "exhausted" });
    }

    if (session.nextPage > session.maxPages) {
      session.adapterStopDetail = "maximum_pages_reached";
      return emptyStep({ done: true, stopHint: "max_budget" });
    }

    const elapsed = Date.now() - session.startedAt;
    if (elapsed > session.timeoutMs) {
      session.adapterStopDetail = "timeout";
      return emptyStep({ done: true, stopHint: "timeout" });
    }

    const batchPages = Array.from(
      {
        length: Math.min(
          session.concurrency,
          session.maxPages - session.nextPage + 1,
          Math.max(1, input.budgetRemaining.maxPagesOrScrolls),
          Math.max(1, input.budgetRemaining.maxRequests),
        ),
      },
      (_value, index) => session.nextPage + index,
    );

    if (batchPages.length === 0) {
      session.adapterStopDetail = "maximum_pages_reached";
      return emptyStep({ done: true, stopHint: "max_budget" });
    }

    session.logger?.(
      `Fetching pages ${batchPages[0]}-${batchPages.at(-1)} concurrently`,
    );
    const remaining = Math.max(1_000, session.timeoutMs - (Date.now() - session.startedAt));
    const batch = await Promise.allSettled(
      batchPages.map((pageNumber) =>
        session.fetchPage(
          pageNumber,
          input.budgetRemaining.maxUnique ?? 10_000,
          remaining,
          session.scope,
        ),
      ),
    );

    const results = batch
      .map((item, index): DevpostApiPageSnapshot => {
        if (item.status === "fulfilled") return item.value;
        const pageNumber = batchPages[index]!;
        return {
          requestedPage: pageNumber,
          requestedUrl: `page:${pageNumber}`,
          finalUrl: `page:${pageNumber}`,
          leads: [],
          cardCount: 0,
          fingerprint: "",
          firstUrls: [],
          lastUrls: [],
          hasNext: false,
          status: "failed",
          stopReason: "api_error",
          error: item.reason instanceof Error ? item.reason.message : "Devpost API page failed",
        };
      })
      .sort((a, b) => a.requestedPage - b.requestedPage);

    let batchHadNext = false;
    const newCards: ListingCard[] = [];
    for (const page of results) {
      newCards.push(...this.mergePage(session, page));
      if (page.hasNext) batchHadNext = true;
    }

    session.nextPage = batchPages.at(-1)! + 1;
    const unseen = newCards.filter((card) => !input.seen.has(card.identity));

    if (session.repeatedPages > 0) {
      session.adapterStopDetail = "repeated_fingerprint";
      return {
        cards: newCards,
        requestsUsed: results.length,
        pagesOrScrollsUsed: results.length,
        actionsUsed: 0,
        grew: unseen.length > 0,
        duplicateRate: newCards.length > 0 ? (newCards.length - unseen.length) / newCards.length : 1,
        done: true,
        stopHint: "no_growth",
      };
    }

    if (unseen.length === 0) {
      session.adapterStopDetail = "no_additional_cards";
      return {
        cards: newCards,
        requestsUsed: results.length,
        pagesOrScrollsUsed: results.length,
        actionsUsed: 0,
        grew: false,
        duplicateRate: 1,
        done: true,
        stopHint: "no_growth",
      };
    }

    if (!batchHadNext) {
      session.exhausted = true;
      session.adapterStopDetail = "no_next_page";
      return {
        cards: newCards,
        requestsUsed: results.length,
        pagesOrScrollsUsed: results.length,
        actionsUsed: 0,
        grew: true,
        duplicateRate: 0,
        done: true,
        stopHint: "exhausted",
      };
    }

    return {
      cards: newCards,
      requestsUsed: results.length,
      pagesOrScrollsUsed: results.length,
      actionsUsed: 0,
      grew: true,
      duplicateRate: 0,
      done: false,
    };
  }

  /** Merge page leads into session; return newly added listing cards only. */
  private mergePage(session: DevpostDirectorySession, page: DevpostApiPageSnapshot): ListingCard[] {
    session.pages.push(page);
    if (page.status === "completed" && typeof page.metaTotalCount === "number") {
      session.metaTotalCount = page.metaTotalCount;
    }
    if (page.fingerprint) {
      const prior = session.seenFingerprints.get(page.fingerprint);
      if (prior != null) {
        session.repeatedPages += 1;
        session.logger?.(`Page ${page.requestedPage} repeated page ${prior}`);
        page.status = "degraded";
        page.stopReason = "repeated_fingerprint";
      } else {
        session.seenFingerprints.set(page.fingerprint, page.requestedPage);
      }
    }

    let added = 0;
    let duplicateExisting = 0;
    const cards: ListingCard[] = [];
    for (const lead of page.leads) {
      const key = leadIdentity(lead);
      if (session.leadsByIdentity.has(key)) {
        session.duplicateUrls += 1;
        duplicateExisting += 1;
        continue;
      }
      session.leadsByIdentity.set(key, lead);
      const bucket = session.classifyOpenState(
        typeof lead.metadata?.status === "string" ? lead.metadata.status : undefined,
      );
      session.statusCounts[bucket] = (session.statusCounts[bucket] ?? 0) + 1;
      cards.push(leadToCard(lead));
      added += 1;
    }
    const capped = Math.max(0, page.leads.length - added - duplicateExisting);
    session.logger?.(
      `Page ${page.requestedPage}: ${page.cardCount} cards - ${added} new${duplicateExisting ? ` - ${duplicateExisting} duplicate` : ""}${capped ? ` - ${capped} capped` : ""}`,
    );
    session.logger?.(
      `Page ${page.requestedPage} URL: requested ${page.requestedUrl}; final ${page.finalUrl}`,
    );
    if (page.firstUrls.length > 0) {
      session.logger?.(
        `Page ${page.requestedPage} fingerprint: first ${page.firstUrls[0]} last ${page.lastUrls.at(-1)}`,
      );
    }
    return cards;
  }
}

export function mapDevpostKernelStopReason(
  stopReason: CrawlStopReason,
  adapterStopDetail: string | undefined,
): string {
  if (adapterStopDetail === "api_page_failed") return "api_page_failed";
  if (adapterStopDetail === "repeated_fingerprint") return "repeated_fingerprint";
  if (adapterStopDetail === "no_additional_cards") return "no_additional_cards";
  if (adapterStopDetail === "no_next_page") return "no_next_page";
  if (adapterStopDetail === "maximum_pages_reached") return "maximum_pages_reached";
  if (adapterStopDetail === "timeout") return "timeout";

  switch (stopReason) {
    case "target_reached":
      return "target_reached";
    case "maximum_cards_reached":
      return "maximum_cards_reached";
    case "exhausted":
      return "no_next_page";
    case "no_growth":
      return "no_additional_cards";
    case "max_budget":
      return "maximum_pages_reached";
    case "timeout":
      return "timeout";
    case "acquisition_failed":
      return "api_page_failed";
    case "cancelled":
      return "cancelled";
    default:
      return stopReason;
  }
}

export function leadsFromDevpostSession(
  session: DevpostDirectorySession | undefined,
  cards: ListingCard[],
): RawLead[] {
  if (!session) return [];
  const leads: RawLead[] = [];
  for (const card of cards) {
    const lead = session.leadsByIdentity.get(card.identity);
    if (lead) leads.push(lead);
  }
  return leads;
}
