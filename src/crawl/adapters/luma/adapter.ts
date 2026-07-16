/**
 * Luma single-feed scroll adapter for DirectoryCrawlKernel.
 * One feed session only — feed order, Tech fallback, and theme metrics stay in the collector.
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

export const LUMA_FEED_ADAPTER_ID = "luma-feed-scroll";
export const LUMA_FEED_ADAPTER_VERSION = "b3-1";

export type LumaFeedGrowHooks = {
  collectLeads: () => Promise<RawLead[]>;
  scroll: () => Promise<void>;
  waitForIdle?: () => Promise<void>;
  waitMs: number;
  noGrowthLimit: number;
  logger?: (message: string) => void;
  loadingMessage?: string;
  countMessage?: (count: number) => string;
};

export type LumaFeedSession = {
  hooks: LumaFeedGrowHooks;
  leadsByIdentity: Map<string, RawLead>;
  pendingCards: ListingCard[];
  initialEmitted: boolean;
  noGrowthAttempts: number;
  scrollAttempts: number;
  adapterStopDetail?: string;
};

function leadIdentity(lead: RawLead): string {
  return normalizeUrlForDedupe(lead.url ?? lead.id);
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
          : "unknown",
    evidence: {
      displayedDateText:
        typeof lead.metadata?.dateText === "string" ? lead.metadata.dateText : undefined,
      locationText:
        typeof lead.metadata?.location === "string" ? lead.metadata.location : undefined,
      organizerText:
        typeof lead.metadata?.organizer === "string" ? lead.metadata.organizer : undefined,
      shortDescription: lead.text,
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emptyStep(opts: {
  done?: boolean;
  stopHint?: CrawlStopReason;
  actionsUsed?: number;
  pagesOrScrollsUsed?: number;
}): GrowthStepResult {
  return {
    cards: [],
    requestsUsed: 0,
    pagesOrScrollsUsed: opts.pagesOrScrollsUsed ?? 0,
    actionsUsed: opts.actionsUsed ?? 0,
    grew: false,
    duplicateRate: 0,
    done: Boolean(opts.done),
    ...(opts.stopHint ? { stopHint: opts.stopHint } : {}),
  };
}

export class LumaFeedAdapter implements DirectoryAdapter<LumaFeedSession> {
  readonly id = LUMA_FEED_ADAPTER_ID;
  readonly version = LUMA_FEED_ADAPTER_VERSION;
  lastSession: LumaFeedSession | undefined;

  constructor(
    private readonly options: {
      feedUrl: string;
      hooks: LumaFeedGrowHooks;
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
    session: LumaFeedSession;
  }> {
    if (input.signal?.aborted) {
      const error = new Error("Crawl cancelled");
      error.name = "AbortError";
      throw error;
    }

    const session: LumaFeedSession = {
      hooks: this.options.hooks,
      leadsByIdentity: new Map(),
      pendingCards: [],
      initialEmitted: false,
      noGrowthAttempts: 0,
      scrollAttempts: 0,
    };

    const cards = await this.mergeCurrentLeads(session);
    session.pendingCards = cards;
    const count = session.leadsByIdentity.size;
    session.hooks.logger?.(
      session.hooks.countMessage?.(count) ?? `${count} unique events found`,
    );

    this.lastSession = session;
    return {
      mechanism: "scroll",
      requestedUrl: input.url || this.options.feedUrl,
      finalUrl: input.url || this.options.feedUrl,
      session,
    };
  }

  async grow(input: {
    session: LumaFeedSession;
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

    if (!session.initialEmitted && session.pendingCards.length > 0) {
      const cards = session.pendingCards;
      session.pendingCards = [];
      session.initialEmitted = true;
      const unseen = cards.filter((card) => !input.seen.has(card.identity));
      return {
        cards,
        requestsUsed: 0,
        pagesOrScrollsUsed: 0,
        actionsUsed: 0,
        grew: unseen.length > 0,
        duplicateRate: cards.length > 0 ? (cards.length - unseen.length) / cards.length : 0,
        done: false,
      };
    }
    session.initialEmitted = true;

    if (input.budgetRemaining.maxPagesOrScrolls <= 0) {
      session.adapterStopDetail = "max_scrolls";
      return emptyStep({ done: true, stopHint: "max_budget" });
    }

    session.scrollAttempts += 1;
    session.hooks.logger?.(session.hooks.loadingMessage ?? "Loading more events...");
    await session.hooks.scroll();
    await sleep(session.hooks.waitMs);
    await session.hooks.waitForIdle?.();

    const newCards = await this.mergeCurrentLeads(session);
    const unseen = newCards.filter((card) => !input.seen.has(card.identity));

    if (unseen.length > 0) {
      session.noGrowthAttempts = 0;
      session.hooks.logger?.(
        session.hooks.countMessage?.(session.leadsByIdentity.size) ??
          `${session.leadsByIdentity.size} unique events found`,
      );
      return {
        cards: newCards,
        requestsUsed: 0,
        pagesOrScrollsUsed: 1,
        actionsUsed: 1,
        grew: true,
        duplicateRate:
          newCards.length > 0 ? (newCards.length - unseen.length) / newCards.length : 0,
        done: false,
      };
    }

    session.noGrowthAttempts += 1;
    if (session.noGrowthAttempts >= session.hooks.noGrowthLimit) {
      session.adapterStopDetail = "no_growth";
      return {
        cards: [],
        requestsUsed: 0,
        pagesOrScrollsUsed: 1,
        actionsUsed: 1,
        grew: false,
        duplicateRate: 1,
        done: true,
        stopHint: "no_growth",
      };
    }

    return {
      cards: [],
      requestsUsed: 0,
      pagesOrScrollsUsed: 1,
      actionsUsed: 1,
      grew: false,
      duplicateRate: 1,
      done: false,
    };
  }

  private async mergeCurrentLeads(session: LumaFeedSession): Promise<ListingCard[]> {
    const leads = await session.hooks.collectLeads();
    const added: ListingCard[] = [];
    for (const lead of leads) {
      const identity = leadIdentity(lead);
      if (!identity || session.leadsByIdentity.has(identity)) continue;
      session.leadsByIdentity.set(identity, lead);
      added.push(leadToCard(lead));
    }
    return added;
  }
}

export function leadsFromLumaFeedSession(
  session: LumaFeedSession | undefined,
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

export function mapLumaKernelStopToStable(
  stopReason: CrawlStopReason,
  adapterStopDetail: string | undefined,
): "no_growth" | "max_items" | "max_scrolls" | "timeout" {
  if (adapterStopDetail === "max_scrolls") return "max_scrolls";
  if (adapterStopDetail === "no_growth") return "no_growth";
  switch (stopReason) {
    case "timeout":
      return "timeout";
    case "max_budget":
      return "max_scrolls";
    case "target_reached":
    case "maximum_cards_reached":
      return "max_items";
    case "no_growth":
    case "exhausted":
    default:
      return "no_growth";
  }
}
