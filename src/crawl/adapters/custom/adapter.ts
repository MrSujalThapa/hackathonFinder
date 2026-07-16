import { type Browser, type BrowserContext, type Page } from "playwright";
import {
  acquireGenericArtifacts,
  actionPriority,
  actionStateFingerprint,
  detectBlockedStateFromHtml,
  executeCandidateAction,
  extractStaticArtifacts,
  makeArtifact,
  scrollNestedContainers,
  scrollPrimaryContainer,
  scrollProbeState,
  visibleIdentityKeys,
  waitForDomStability,
} from "@/crawl/adapters/custom/generic/acquisition";
import {
  enumerateCandidateActionsFromHtml,
  verifyActionStateProgression,
} from "@/crawl/adapters/custom/generic/browserActions";
import type {
  AcquiredArtifact,
  CandidateAction,
  SourceExperiment,
} from "@/crawl/adapters/custom/generic/types";
import { byteLength, isSafePublicOrigin } from "@/crawl/adapters/custom/generic/valueUtils";
import {
  CUSTOM_ADAPTER_VERSION,
  buildCrawlPlan,
  loadCrawlPlan,
  saveCrawlPlan,
  shortPageFingerprint,
  structuralSignatureFromShape,
  validateCrawlPlan,
  type CrawlPlanCacheStatus,
  type CustomCrawlPlanV1,
} from "@/crawl/adapters/custom/crawlPlan";
import {
  artifactsSufficientForStatic,
  extractListingCards,
  type CardExtractionDiagnostics,
} from "@/crawl/adapters/custom/extractCards";
import { isOriginAllowed, originVariants } from "@/crawl/adapters/custom/origins";
import type {
  CrawlBudget,
  CrawlMechanism,
  DirectoryAdapter,
  GrowthStepResult,
  ListingCard,
} from "@/crawl/types";
import { CRAWL_KERNEL_VERSION } from "@/crawl/types";

export type CustomAdapterSource = {
  slug: string;
  listingUrl: string;
  mode: "static" | "playwright" | "auto" | "rss" | "sitemap";
  maxItems: number;
  browserAllowed?: boolean;
};

export type CustomDirectorySession = {
  source: CustomAdapterSource;
  experiment: SourceExperiment;
  mechanism: CrawlMechanism;
  requestedUrl: string;
  finalUrl: string;
  allowedOrigins: string[];
  artifacts: AcquiredArtifact[];
  pendingCards: ListingCard[];
  initialEmitted: boolean;
  aiUsedThisCycle: boolean;
  selectedUnitSetId?: string;
  extraction?: CardExtractionDiagnostics;
  plan?: CustomCrawlPlanV1;
  planCacheStatus: CrawlPlanCacheStatus;
  blockedReason?: string;
  browser?: {
    browser: Browser;
    context: BrowserContext;
    page: Page;
    html: string;
    seenIdentityKeys: Set<string>;
    previousFingerprint: string;
    attemptedFingerprintByAction: Map<string, string>;
    scrollNoGrowth: number;
  };
  structuralSignature?: string;
  discoveryCycleId: string;
  /** Pages/actions already performed during acquireGenericArtifacts. */
  acquisitionActions?: number;
  acquisitionPages?: number;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Crawl cancelled");
    error.name = "AbortError";
    throw error;
  }
}

function toExperiment(source: CustomAdapterSource, allowedOrigins: string[]): SourceExperiment {
  const isHackathonsSpace = /hackathons\.space/i.test(source.listingUrl);
  return {
    inputUrl: source.listingUrl,
    allowedOrigins,
    maxRequests: Math.max(8, Math.min(40, source.maxItems)),
    maxPages: isHackathonsSpace
      ? 3
      : Math.max(3, Math.min(20, Math.ceil(source.maxItems / 10))),
    maxBrowserActions: isHackathonsSpace ? 3 : 8,
    maxPayloadBytes: 5_000_000,
    browserAllowed: source.browserAllowed ?? source.mode !== "static",
    expectedContentCategory: "public_event_directory",
    ...(isHackathonsSpace ? { expectedMinimumEventCount: 20 } : {}),
  };
}

function detectMechanism(input: {
  html: string;
  baseUrl: string;
  experiment: SourceExperiment;
  preferred?: CrawlMechanism;
}): CrawlMechanism {
  if (input.preferred && input.preferred !== "static") return input.preferred;
  const actions = enumerateCandidateActionsFromHtml(input.html, input.baseUrl).filter(
    (action) =>
      !action.disabled &&
      action.confidence >= 0.55 &&
      (action.proposedEffect === "next_page" || action.proposedEffect === "load_more") &&
      (!action.href || isSafePublicOrigin(action.href, input.experiment.allowedOrigins)),
  );
  if (actions.length > 0) return "next";
  return "scroll";
}

function pickNextAction(html: string, baseUrl: string, experiment: SourceExperiment): CandidateAction | undefined {
  return enumerateCandidateActionsFromHtml(html, baseUrl)
    .filter(
      (action) =>
        !action.disabled &&
        action.confidence >= 0.55 &&
        (action.proposedEffect === "next_page" ||
          action.proposedEffect === "load_more" ||
          action.proposedEffect === "change_filter" ||
          action.proposedEffect === "change_sort") &&
        (!action.href || isSafePublicOrigin(action.href, experiment.allowedOrigins)),
    )
    .sort((left, right) => actionPriority(right) - actionPriority(left))[0];
}

async function capturePageArtifact(page: Page, experiment: SourceExperiment, index: number): Promise<{
  html: string;
  artifact: AcquiredArtifact;
}> {
  const html = await page.content();
  const artifact = makeArtifact({
    kind: "dom_snapshot",
    index,
    sourceUrl: page.url(),
    contentType: "text/html",
    payload: {
      title: await page.title().catch(() => ""),
      textLength: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length,
      html,
    },
    rawBytes: byteLength(html),
    acquisitionMode: "browser",
    timingMs: 0,
  });
  if (byteLength(html) > experiment.maxPayloadBytes) {
    throw new Error("Page payload exceeded maxPayloadBytes");
  }
  return { html, artifact };
}

function cardsToStep(cards: ListingCard[], opts: Partial<GrowthStepResult> = {}): GrowthStepResult {
  return {
    cards,
    requestsUsed: opts.requestsUsed ?? 0,
    pagesOrScrollsUsed: opts.pagesOrScrollsUsed ?? 0,
    actionsUsed: opts.actionsUsed ?? 0,
    grew: cards.length > 0,
    duplicateRate: opts.duplicateRate ?? 0,
    done: opts.done ?? false,
    ...(opts.stopHint ? { stopHint: opts.stopHint } : {}),
  };
}

export class CustomDirectoryAdapter implements DirectoryAdapter<CustomDirectorySession> {
  readonly id = "custom-directory";
  readonly version = CUSTOM_ADAPTER_VERSION;

  constructor(private readonly source: CustomAdapterSource) {}

  async acquire(input: {
    url: string;
    budget: CrawlBudget;
    signal?: AbortSignal;
  }): Promise<{
    mechanism: CrawlMechanism;
    requestedUrl: string;
    finalUrl: string;
    session: CustomDirectorySession;
  }> {
    throwIfAborted(input.signal);
    const requestedUrl = input.url;
    let origin = requestedUrl;
    try {
      origin = new URL(requestedUrl).origin;
    } catch {
      throw new Error("Invalid custom source URL");
    }
    const allowedOrigins = originVariants(origin);
    const experiment = toExperiment(this.source, allowedOrigins);
    const cachedPlan = await loadCrawlPlan(this.source.slug);
    let planCacheStatus: CrawlPlanCacheStatus = cachedPlan ? "hit" : "absent";
    let plan = cachedPlan;

    const route = (() => {
      try {
        return new URL(requestedUrl).pathname.replace(/\/$/, "") || "/";
      } catch {
        return "/";
      }
    })();

    // Static acquisition first when mode allows.
    if (this.source.mode !== "playwright") {
      const response = await fetch(requestedUrl, {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "user-agent": "hackathon-finder-custom-kernel/1.0",
        },
        signal: input.signal,
      });
      throwIfAborted(input.signal);
      if (response.ok) {
        const finalUrl = response.url || requestedUrl;
        if (!isOriginAllowed(finalUrl, allowedOrigins)) {
          throw new Error(`Final URL escaped allowed origins: ${new URL(finalUrl).origin}`);
        }
        const html = await response.text();
        if (byteLength(html) > experiment.maxPayloadBytes) {
          throw new Error("Static payload exceeded maxPayloadBytes");
        }
        const blockedReason = detectBlockedStateFromHtml(html);
        if (blockedReason === "human_verification") {
          return {
            mechanism: "static",
            requestedUrl,
            finalUrl,
            session: {
              source: this.source,
              experiment,
              mechanism: "static",
              requestedUrl,
              finalUrl,
              allowedOrigins,
              artifacts: [],
              pendingCards: [],
              initialEmitted: false,
              aiUsedThisCycle: false,
              planCacheStatus: "miss",
              blockedReason: "blocked_human_verification",
              discoveryCycleId: `discover-${Date.now()}`,
            },
          };
        }
        const staticResult = extractStaticArtifacts(html, finalUrl, experiment, 0);
        const artifacts = staticResult.artifacts;
        const staticOk =
          this.source.mode === "static" || artifactsSufficientForStatic(artifacts, experiment);

        if (staticOk) {
          const extraction = await extractListingCards({
            artifacts,
            experiment,
            allowAiSelection: true,
            signal: input.signal,
          });
          const signature = structuralSignatureFromShape({
            mechanism: "static",
            unitTag: extraction.diagnostics.unitTag,
            unitCount: extraction.diagnostics.unitCount,
            sampleTitles: extraction.diagnostics.sampleTitles,
          });
          if (plan) {
            const validation = validateCrawlPlan({
              plan,
              requestedUrl,
              finalUrl,
              allowedOrigins,
              structuralSignature: signature,
              blockedReason,
            });
            if (!validation.ok) {
              planCacheStatus = "invalidated";
              plan = undefined;
            }
          }
          return {
            mechanism: "static",
            requestedUrl,
            finalUrl,
            session: {
              source: this.source,
              experiment,
              mechanism: "static",
              requestedUrl,
              finalUrl,
              allowedOrigins,
              artifacts,
              pendingCards: extraction.cards,
              initialEmitted: false,
              aiUsedThisCycle: extraction.diagnostics.aiInvoked || extraction.diagnostics.aiSelectionUsed,
              selectedUnitSetId: extraction.diagnostics.selectedUnitSetId,
              extraction: extraction.diagnostics,
              plan,
              planCacheStatus: plan ? planCacheStatus : planCacheStatus === "invalidated" ? "invalidated" : "miss",
              structuralSignature: signature,
              discoveryCycleId: `discover-${Date.now()}`,
            },
          };
        }
      }
    }

    if (!experiment.browserAllowed) {
      throw new Error("Static acquisition insufficient and browser disabled");
    }

    throwIfAborted(input.signal);
    // Proven browser acquisition (static→page-param→Playwright Next/scroll) lives in
    // production generic acquisition. Kernel still owns identity merge, budgets, and stop.
    const acquisition = await acquireGenericArtifacts(experiment, (artifacts) =>
      artifactsSufficientForStatic(artifacts, experiment),
    );
    const finalUrl = acquisition.diagnostics.finalUrl || requestedUrl;
    if (!isOriginAllowed(finalUrl, allowedOrigins)) {
      throw new Error(`Browser final URL escaped allowed origins: ${new URL(finalUrl).origin}`);
    }
    if (
      acquisition.diagnostics.blockedReason === "human_verification" ||
      /human|captcha|awswaf/i.test(acquisition.diagnostics.blockedReason ?? "")
    ) {
      return {
        mechanism: "scroll",
        requestedUrl,
        finalUrl,
        session: {
          source: this.source,
          experiment,
          mechanism: "scroll",
          requestedUrl,
          finalUrl,
          allowedOrigins,
          artifacts: acquisition.artifacts,
          pendingCards: [],
          initialEmitted: false,
          aiUsedThisCycle: false,
          planCacheStatus: "miss",
          blockedReason: "blocked_human_verification",
          discoveryCycleId: `discover-${Date.now()}`,
        },
      };
    }

    const htmlArtifact = [...acquisition.artifacts]
      .reverse()
      .find((artifact) => artifact.kind === "html" || artifact.kind === "dom_snapshot");
    const html =
      htmlArtifact && typeof (htmlArtifact.payload as { html?: string }).html === "string"
        ? (htmlArtifact.payload as { html: string }).html
        : "";
    const preferred = plan?.mechanism;
    let mechanism = detectMechanism({
      html: html || "<html></html>",
      baseUrl: finalUrl,
      experiment,
      preferred,
    });
    const nextActions = (acquisition.diagnostics.actionTrace ?? []).filter(
      (trace) => trace.accepted && (trace.effect === "next_page" || trace.effect === "load_more"),
    ).length;
    const scrollActions = (acquisition.diagnostics.actionTrace ?? []).filter(
      (trace) => trace.accepted && trace.effect === "infinite_scroll",
    ).length;
    if (nextActions > 0) mechanism = "next";
    else if (scrollActions > 0) mechanism = "scroll";
    else if (acquisition.artifacts.some((artifact) => artifact.acquisitionMode === "browser")) {
      mechanism = mechanism === "static" ? "scroll" : mechanism;
    }

    const extraction = await extractListingCards({
      artifacts: acquisition.artifacts,
      experiment,
      allowAiSelection: true,
      signal: input.signal,
    });
    const signature = structuralSignatureFromShape({
      mechanism,
      unitTag: extraction.diagnostics.unitTag,
      unitCount: extraction.diagnostics.unitCount,
      sampleTitles: extraction.diagnostics.sampleTitles,
    });
    if (plan) {
      const validation = validateCrawlPlan({
        plan,
        requestedUrl,
        finalUrl,
        allowedOrigins,
        structuralSignature: signature,
      });
      if (!validation.ok) {
        planCacheStatus = "invalidated";
        plan = undefined;
      }
    }

    return {
      mechanism,
      requestedUrl,
      finalUrl,
      session: {
        source: this.source,
        experiment,
        mechanism,
        requestedUrl,
        finalUrl,
        allowedOrigins,
        artifacts: acquisition.artifacts,
        pendingCards: extraction.cards,
        initialEmitted: false,
        aiUsedThisCycle: extraction.diagnostics.aiInvoked || extraction.diagnostics.aiSelectionUsed,
        selectedUnitSetId: extraction.diagnostics.selectedUnitSetId,
        extraction: extraction.diagnostics,
        plan,
        planCacheStatus: plan ? planCacheStatus : planCacheStatus === "invalidated" ? "invalidated" : "miss",
        structuralSignature: signature,
        discoveryCycleId: `discover-${Date.now()}`,
        acquisitionActions: acquisition.diagnostics.actionsExecuted ?? 0,
        acquisitionPages: acquisition.diagnostics.pagesRequested ?? acquisition.diagnostics.browserPages ?? 1,
      },
    };
  }

  async grow(input: {
    session: CustomDirectorySession;
    budgetRemaining: CrawlBudget;
    seen: ReadonlySet<string>;
    signal?: AbortSignal;
  }): Promise<GrowthStepResult> {
    throwIfAborted(input.signal);
    const session = input.session;

    if (session.blockedReason === "blocked_human_verification") {
      return cardsToStep([], {
        done: true,
        stopHint: "blocked_human_verification",
      });
    }
    if (session.blockedReason === "blocked_authentication") {
      return cardsToStep([], {
        done: true,
        stopHint: "blocked_authentication",
      });
    }

    if (!session.initialEmitted) {
      session.initialEmitted = true;
      if (session.pendingCards.length === 0 && session.mechanism === "static") {
        if (session.extraction?.aiUnavailable) {
          return cardsToStep([], {
            done: true,
            stopHint: "acquisition_failed",
          });
        }
        return cardsToStep([], { done: true, stopHint: "no_growth" });
      }
      return cardsToStep(session.pendingCards, {
        requestsUsed: 1,
        pagesOrScrollsUsed: Math.max(1, session.acquisitionPages ?? 1),
        actionsUsed: session.acquisitionActions ?? 0,
        grew: session.pendingCards.length > 0,
        // Acquisition already performed bounded Next/scroll growth.
        done: !session.browser,
      });
    }

    if (session.mechanism === "static" || !session.browser) {
      return cardsToStep([], { done: true });
    }

    if (input.budgetRemaining.maxBrowserActions <= 0 || input.budgetRemaining.maxPagesOrScrolls <= 0) {
      return cardsToStep([], { done: true, stopHint: "max_budget" });
    }

    const { page } = session.browser;
    let grew = false;
    let actionsUsed = 0;
    let pagesOrScrollsUsed = 0;
    let requestsUsed = 0;

    if (session.mechanism === "next") {
      const action = pickNextAction(session.browser.html, page.url(), session.experiment);
      if (!action) {
        return cardsToStep([], { done: true });
      }
      if (action.href && !isSafePublicOrigin(action.href, session.allowedOrigins)) {
        return cardsToStep([], { done: true, stopHint: "acquisition_failed" });
      }
      await executeCandidateAction(page, action);
      await waitForDomStability(page);
      await scrollNestedContainers(page);
      actionsUsed = 1;
      pagesOrScrollsUsed = 1;
      requestsUsed = 1;
    } else {
      // scroll growth
      const beforeScroll = await scrollProbeState(page);
      const couldMove = beforeScroll.scrollTop + beforeScroll.clientHeight < beforeScroll.scrollHeight - 8;
      await page.mouse.wheel(0, 2_400).catch(() => undefined);
      const afterScroll = await scrollPrimaryContainer(page);
      await page.waitForTimeout(afterScroll.loadingDetected ? 1_000 : 700);
      await page.waitForLoadState("networkidle", { timeout: 2_500 }).catch(() => undefined);
      actionsUsed = 1;
      pagesOrScrollsUsed = 1;
      if (!couldMove && !afterScroll.loadingDetected && afterScroll.scrollTop <= beforeScroll.scrollTop) {
        session.browser.scrollNoGrowth += 1;
        if (session.browser.scrollNoGrowth >= 2) {
          return cardsToStep([], { done: true, actionsUsed, pagesOrScrollsUsed });
        }
      }
    }

    const finalUrl = page.url();
    if (!isOriginAllowed(finalUrl, session.allowedOrigins)) {
      return cardsToStep([], {
        done: true,
        stopHint: "acquisition_failed",
        actionsUsed,
        pagesOrScrollsUsed,
        requestsUsed,
      });
    }
    session.finalUrl = finalUrl;

    const { html, artifact } = await capturePageArtifact(page, session.experiment, session.artifacts.length);
    const blocked = detectBlockedStateFromHtml(html);
    if (blocked === "human_verification") {
      session.blockedReason = "blocked_human_verification";
      return cardsToStep([], {
        done: true,
        stopHint: "blocked_human_verification",
        actionsUsed,
        pagesOrScrollsUsed,
        requestsUsed,
      });
    }

    const identityKeys = visibleIdentityKeys(html, finalUrl);
    const nextFingerprint = actionStateFingerprint(html, finalUrl);
    const progression = verifyActionStateProgression({
      actionId: `grow:${session.artifacts.length}`,
      beforeFingerprint: session.browser.previousFingerprint,
      afterFingerprint: nextFingerprint,
      seenIdentityKeys: session.browser.seenIdentityKeys,
      nextIdentityKeys: identityKeys,
      attemptedFingerprintByAction: session.browser.attemptedFingerprintByAction,
    });
    session.browser.attemptedFingerprintByAction.set(
      `grow:${session.artifacts.length}`,
      session.browser.previousFingerprint,
    );

    if (!progression.accepted) {
      if (session.mechanism === "scroll") {
        session.browser.scrollNoGrowth += 1;
        if (session.browser.scrollNoGrowth >= 3) {
          return cardsToStep([], { done: true, actionsUsed, pagesOrScrollsUsed, requestsUsed });
        }
      }
      return cardsToStep([], {
        grew: false,
        actionsUsed,
        pagesOrScrollsUsed,
        requestsUsed,
        duplicateRate: 1,
      });
    }

    identityKeys.forEach((key) => session.browser!.seenIdentityKeys.add(key));
    session.browser.previousFingerprint = nextFingerprint;
    session.browser.html = html;
    session.artifacts.push(artifact);
    session.browser.scrollNoGrowth = 0;
    grew = true;

    const extraction = await extractListingCards({
      artifacts: session.artifacts,
      experiment: session.experiment,
      selectedUnitSetId: session.selectedUnitSetId,
      allowAiSelection: false,
      aiAlreadyUsed: session.aiUsedThisCycle,
      signal: input.signal,
    });
    let cards = extraction.cards;
    if (cards.filter((card) => !input.seen.has(card.identity)).length === 0) {
      const retry = await extractListingCards({
        artifacts: session.artifacts,
        experiment: session.experiment,
        allowAiSelection: false,
        aiAlreadyUsed: true,
        signal: input.signal,
      });
      cards = retry.cards;
      session.extraction = {
        ...retry.diagnostics,
        // Preserve discovery-cycle AI flags from acquire.
        aiSelectionUsed: session.extraction?.aiSelectionUsed || retry.diagnostics.aiSelectionUsed,
        aiInvoked: session.extraction?.aiInvoked || retry.diagnostics.aiInvoked,
        aiUnavailable: session.extraction?.aiUnavailable || retry.diagnostics.aiUnavailable,
        deterministicOk: session.extraction?.deterministicOk ?? retry.diagnostics.deterministicOk,
      };
      if (retry.diagnostics.selectedUnitSetId) {
        session.selectedUnitSetId = retry.diagnostics.selectedUnitSetId;
      }
    } else {
      session.extraction = {
        ...extraction.diagnostics,
        aiSelectionUsed: session.extraction?.aiSelectionUsed || extraction.diagnostics.aiSelectionUsed,
        aiInvoked: session.extraction?.aiInvoked || extraction.diagnostics.aiInvoked,
        aiUnavailable: session.extraction?.aiUnavailable || extraction.diagnostics.aiUnavailable,
        deterministicOk: session.extraction?.deterministicOk ?? extraction.diagnostics.deterministicOk,
      };
    }

    const fresh = cards.filter((card) => !input.seen.has(card.identity));
    return cardsToStep(fresh, {
      grew: grew && fresh.length > 0,
      actionsUsed,
      pagesOrScrollsUsed,
      requestsUsed,
      duplicateRate:
        cards.length === 0 ? 1 : (cards.length - fresh.length) / Math.max(1, cards.length),
    });
  }

  async release(session: CustomDirectorySession): Promise<void> {
    if (session.browser) {
      await session.browser.context.close().catch(() => undefined);
      await session.browser.browser.close().catch(() => undefined);
      session.browser = undefined;
    }
  }
}

export async function persistSuccessfulCrawlPlan(input: {
  session: CustomDirectorySession;
  sourceState: CustomCrawlPlanV1["lastQuality"];
  uniqueCards: number;
  usable: boolean;
}): Promise<void> {
  if (!input.usable) {
    if (input.session.plan) {
      const failed = {
        ...input.session.plan,
        consecutiveFailures: input.session.plan.consecutiveFailures + 1,
        lastQuality: input.sourceState,
      };
      await saveCrawlPlan(input.session.source.slug, failed).catch(() => undefined);
    }
    return;
  }
  const route = (() => {
    try {
      return new URL(input.session.requestedUrl).pathname.replace(/\/$/, "") || "/";
    } catch {
      return "/";
    }
  })();
  const plan = buildCrawlPlan({
    mechanism: input.session.mechanism,
    allowedOrigins: input.session.allowedOrigins,
    route,
    structuralSignature:
      input.session.structuralSignature ??
      structuralSignatureFromShape({
        mechanism: input.session.mechanism,
        sampleTitles: input.session.extraction?.sampleTitles,
      }),
    pageFingerprint: input.session.browser
      ? shortPageFingerprint(input.session.browser.html)
      : undefined,
    observedInventory: input.uniqueCards,
    lastQuality: input.sourceState,
    consecutiveFailures: 0,
    kernelVersion: CRAWL_KERNEL_VERSION,
  });
  await saveCrawlPlan(input.session.source.slug, plan).catch(() => undefined);
}
