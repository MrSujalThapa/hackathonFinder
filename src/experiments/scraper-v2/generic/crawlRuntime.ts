import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  CheerioCrawler,
  Configuration,
  LogLevel,
  MemoryStorage,
  PlaywrightCrawler,
  RequestQueue,
  type CheerioCrawlingContext,
  type PlaywrightCrawlingContext,
} from "crawlee";
import {
  acquireGenericArtifacts,
  extractStaticArtifacts,
  makeArtifact,
  parseJsonSafe,
  shouldCaptureNetworkResponse,
} from "@/experiments/scraper-v2/generic/acquisition";
import { enumerateCandidateActionsFromHtml } from "@/experiments/scraper-v2/generic/browserActions";
import { checkpointId, LocalCheckpointStore } from "@/experiments/scraper-v2/generic/checkpoints";
import { summarizeDateCoverage } from "@/experiments/scraper-v2/generic/dateCoverage";
import { throwIfCancelled } from "@/experiments/scraper-v2/generic/runtimeControls";
import type {
  AcquiredArtifact,
  AcquisitionDiagnostics,
  CrawlRuntime,
  CrawlRuntimeInput,
  CrawlRuntimeResult,
  DiscoveryBudget,
  SourceExperiment,
} from "@/experiments/scraper-v2/generic/types";
import { byteLength, boundedJson, isPlainRecord, isSafePublicOrigin } from "@/experiments/scraper-v2/generic/valueUtils";

type RuntimeLimits = {
  experiment: SourceExperiment;
  maxConcurrency: number;
  perHostConcurrency: number;
  navigationTimeoutSecs: number;
  requestHandlerTimeoutSecs: number;
  maxRequestRetries: number;
  browserActionTransitions: number;
  deadlineMs: number;
};

function ms(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function hash(value: unknown): string {
  return createHash("sha256").update(boundedJson(value, 20_000)).digest("hex").slice(0, 16);
}

function artifactFingerprint(artifact: AcquiredArtifact): string {
  return `${artifact.kind}:${hash(artifact.payload)}`;
}

function hostKey(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}

function constrainExperiment(experiment: SourceExperiment, budget?: DiscoveryBudget): RuntimeLimits {
  const maxRequests = Math.max(1, Math.min(experiment.maxRequests, budget?.maxRequestsPerSource ?? experiment.maxRequests));
  const maxPages = Math.max(1, Math.min(experiment.maxPages, budget?.maxPagesPerSource ?? experiment.maxPages));
  const profile = budget?.profile ?? "standard";
  return {
    experiment: { ...experiment, maxRequests, maxPages },
    maxConcurrency: profile === "quick" ? 2 : profile === "deep" || profile === "exhaustive" ? 6 : 4,
    perHostConcurrency: profile === "quick" ? 1 : 2,
    navigationTimeoutSecs: profile === "quick" ? 8 : profile === "standard" ? 15 : 25,
    requestHandlerTimeoutSecs: profile === "quick" ? 10 : profile === "standard" ? 20 : 35,
    maxRequestRetries: profile === "quick" ? 1 : 2,
    browserActionTransitions: profile === "quick" ? 1 : 2,
    deadlineMs: budget?.maxDurationMs ?? 120_000,
  };
}

function crawleeConfig(): Configuration {
  return new Configuration({
    storageClient: new MemoryStorage({ persistStorage: false }),
    persistStorage: false,
    purgeOnStart: true,
    logLevel: LogLevel.ERROR,
  });
}

function renumberArtifacts(artifacts: AcquiredArtifact[], startingIndex: number): AcquiredArtifact[] {
  return artifacts.map((artifact, offset) => ({
    ...artifact,
    artifactId: `${artifact.kind}:${startingIndex + offset}`,
  }));
}

function bodyText(body: string | Buffer): string {
  return Buffer.isBuffer(body) ? body.toString("utf8") : body;
}

function finalRequestUrl(request: { loadedUrl?: string; url: string }): string {
  return request.loadedUrl ?? request.url;
}

function extractNextJsonUrl(value: unknown, baseUrl: string, allowedOrigins: string[], depth = 0): string | undefined {
  if (depth > 5 || value == null) return undefined;
  if (Array.isArray(value)) {
    for (const child of value.slice(0, 10)) {
      const next = extractNextJsonUrl(child, baseUrl, allowedOrigins, depth + 1);
      if (next) return next;
    }
    return undefined;
  }
  if (!isPlainRecord(value)) return undefined;
  for (const [key, child] of Object.entries(value)) {
    const keyText = key.toLowerCase();
    if (/\b(next|next_page|nextpage|next_url|nexturl)\b/.test(keyText) && typeof child === "string") {
      const resolved = new URL(child, baseUrl).toString();
      if (isSafePublicOrigin(resolved, allowedOrigins)) return resolved;
    }
    const next = extractNextJsonUrl(child, baseUrl, allowedOrigins, depth + 1);
    if (next) return next;
  }
  return undefined;
}

function numericNextPageUrl(currentUrl: string, allowedOrigins: string[]): string | undefined {
  const parsed = new URL(currentUrl);
  for (const param of ["page", "p"]) {
    const raw = parsed.searchParams.get(param);
    if (!raw) continue;
    const page = Number(raw);
    if (!Number.isInteger(page) || page < 1) continue;
    parsed.searchParams.set(param, String(page + 1));
    const next = parsed.toString();
    if (isSafePublicOrigin(next, allowedOrigins)) return next;
  }
  return undefined;
}

function htmlActionUrls(html: string, baseUrl: string, experiment: SourceExperiment): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $("a[rel~='next'][href]").each((_index, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    const resolved = new URL(href, baseUrl).toString();
    if (isSafePublicOrigin(resolved, experiment.allowedOrigins)) urls.add(resolved);
  });
  for (const action of enumerateCandidateActionsFromHtml(html, baseUrl)) {
    if (action.disabled || !action.href) continue;
    if (action.confidence < 0.55) continue;
    if (action.proposedEffect !== "next_page" && action.proposedEffect !== "load_more") continue;
    if (isSafePublicOrigin(action.href, experiment.allowedOrigins)) urls.add(action.href);
  }
  const numeric = numericNextPageUrl(baseUrl, experiment.allowedOrigins);
  if (numeric) urls.add(numeric);
  return [...urls];
}

function shouldQueueMore(input: {
  artifacts: AcquiredArtifact[];
  queuedUrls: Set<string>;
  url: string;
  experiment: SourceExperiment;
}): boolean {
  return (
    input.artifacts.length < input.experiment.maxRequests &&
    input.queuedUrls.size < input.experiment.maxPages &&
    !input.queuedUrls.has(input.url) &&
    isSafePublicOrigin(input.url, input.experiment.allowedOrigins)
  );
}

async function saveRuntimeCheckpoint(input: {
  rootDir?: string;
  experiment: SourceExperiment;
  budget?: DiscoveryBudget;
  artifacts: AcquiredArtifact[];
}): Promise<{ loaded: boolean; saved: boolean }> {
  if (!input.rootDir || !input.budget || !["deep", "exhaustive"].includes(input.budget.profile)) {
    return { loaded: false, saved: false };
  }
  const store = new LocalCheckpointStore(input.rootDir);
  const id = checkpointId({
    sourceUrl: input.experiment.inputUrl,
    profile: input.budget.profile,
    dateHorizonStart: input.budget.dateHorizonStart,
    dateHorizonEnd: input.budget.dateHorizonEnd,
  });
  const loaded = Boolean(await store.load(id));
  await store.save(id, {
    sourceUrl: input.experiment.inputUrl,
    pageFingerprint: hash(input.artifacts.map((artifact) => artifactFingerprint(artifact))),
    paginationState: { artifactCount: input.artifacts.length },
    seenIdentityHashes: [...new Set(input.artifacts.map(artifactFingerprint))],
    pagesCompleted: input.artifacts.filter((artifact) => artifact.kind === "html" || artifact.kind === "dom_snapshot").length,
    recordsObserved: input.artifacts.length,
    dateCoverage: summarizeDateCoverage({
      leads: [],
      rawRecords: input.artifacts.length,
      dateHorizonStart: input.budget.dateHorizonStart,
      dateHorizonEnd: input.budget.dateHorizonEnd,
    }),
    updatedAt: new Date().toISOString(),
  });
  return { loaded, saved: true };
}

export class ExistingCustomRuntime implements CrawlRuntime {
  readonly name = "custom" as const;

  async crawl(input: CrawlRuntimeInput): Promise<CrawlRuntimeResult> {
    const limits = constrainExperiment(input.experiment, input.budget);
    throwIfCancelled(input.signal);
    const acquisition = await acquireGenericArtifacts(limits.experiment, input.staticArtifactsSufficient);
    const checkpoint = await saveRuntimeCheckpoint({
      rootDir: input.checkpointDir,
      experiment: limits.experiment,
      budget: input.budget,
      artifacts: acquisition.artifacts,
    });
    return {
      runtime: this.name,
      artifacts: acquisition.artifacts,
      diagnostics: {
        ...acquisition.diagnostics,
        runtime: this.name,
        checkpointLoaded: checkpoint.loaded,
        checkpointSaved: checkpoint.saved,
      },
    };
  }
}

export class CrawleeRuntime implements CrawlRuntime {
  readonly name = "crawlee" as const;

  async crawl(input: CrawlRuntimeInput): Promise<CrawlRuntimeResult> {
    throwIfCancelled(input.signal);
    const limits = constrainExperiment(input.experiment, input.budget);
    const experiment = limits.experiment;
    const startedAt = performance.now();
    const attemptedLayers = ["crawlee http"];
    const skippedLayers: string[] = [];
    const config = crawleeConfig();
    const queue = await RequestQueue.open(`scraper-v2-${hash([experiment.inputUrl, Date.now(), Math.random()])}`, { config });
    const artifacts: AcquiredArtifact[] = [];
    const fingerprints = new Set<string>();
    const queuedUrls = new Set<string>();
    const hostActive = new Map<string, number>();
    let requestsMade = 0;
    let pagesRequested = 0;
    let queueRequestsAdded = 0;
    let queueDuplicateRequests = 0;
    let retriesAttempted = 0;
    let finalUrl = experiment.inputUrl;
    let paginationExecuted = false;
    let paginationStopReason: NonNullable<AcquisitionDiagnostics["paginationStopReason"]> = "not_attempted";

    const enqueue = async (url: string, forefront = false): Promise<void> => {
      if (!shouldQueueMore({ artifacts, queuedUrls, url, experiment })) return;
      queuedUrls.add(url);
      const info = await queue.addRequest({ url, uniqueKey: url }, { forefront });
      if (info.wasAlreadyPresent) queueDuplicateRequests += 1;
      else queueRequestsAdded += 1;
    };

    const addArtifacts = (nextArtifacts: AcquiredArtifact[]): void => {
      for (const artifact of nextArtifacts) {
        if (artifacts.length >= experiment.maxRequests) return;
        const fingerprint = artifactFingerprint(artifact);
        if (fingerprints.has(fingerprint)) continue;
        fingerprints.add(fingerprint);
        artifacts.push({ ...artifact, artifactId: `${artifact.kind}:${artifacts.length}` });
      }
    };

    await enqueue(experiment.inputUrl, true);
    const crawler = new CheerioCrawler(
      {
        requestQueue: queue,
        maxRequestsPerCrawl: experiment.maxRequests,
        minConcurrency: 1,
        maxConcurrency: limits.maxConcurrency,
        sameDomainDelaySecs: 0.1,
        maxRequestRetries: limits.maxRequestRetries,
        navigationTimeoutSecs: limits.navigationTimeoutSecs,
        requestHandlerTimeoutSecs: limits.requestHandlerTimeoutSecs,
        additionalMimeTypes: ["application/json", "text/plain"],
        preNavigationHooks: [
          (_context, gotOptions) => {
            throwIfCancelled(input.signal);
            gotOptions.headers = {
              ...gotOptions.headers,
              accept: "text/html,application/xhtml+xml,application/json,text/plain,*/*;q=0.8",
              "user-agent": "hackathon-finder-crawlee-v2-experiment/1.0",
            };
            gotOptions.signal = input.signal;
          },
        ],
        errorHandler: () => {
          retriesAttempted += 1;
        },
        async requestHandler(context: CheerioCrawlingContext) {
          throwIfCancelled(input.signal);
          const currentHost = hostKey(context.request.url);
          const active = (hostActive.get(currentHost) ?? 0) + 1;
          hostActive.set(currentHost, active);
          try {
            if (active > limits.perHostConcurrency) {
              throw new Error(`per-host concurrency exceeded for ${currentHost}`);
            }
            requestsMade += 1;
            pagesRequested += 1;
            finalUrl = finalRequestUrl(context.request);
            if (!isSafePublicOrigin(finalUrl, experiment.allowedOrigins)) {
              throw new Error(`Crawlee final URL escaped allowed origins: ${new URL(finalUrl).origin}`);
            }
            const raw = bodyText(context.body);
            if (!raw || byteLength(raw) > experiment.maxPayloadBytes) return;
            const contentType = context.contentType.type || context.response.headers["content-type"] || "";
            if (/json|text\/plain/i.test(String(contentType))) {
              const payload = parseJsonSafe(raw, experiment.maxPayloadBytes);
              if (payload !== undefined) {
                addArtifacts([
                  makeArtifact({
                    kind: "network_json",
                    index: artifacts.length,
                    sourceUrl: finalUrl,
                    contentType: String(contentType),
                    payload,
                    rawBytes: byteLength(raw),
                    acquisitionMode: "static",
                    timingMs: ms(startedAt),
                  }),
                ]);
                const next = extractNextJsonUrl(payload, finalUrl, experiment.allowedOrigins) ?? numericNextPageUrl(finalUrl, experiment.allowedOrigins);
                if (next && queuedUrls.size < experiment.maxPages) {
                  paginationExecuted = true;
                  await enqueue(next);
                }
              }
              return;
            }
            const extracted = extractStaticArtifacts(raw, finalUrl, experiment, ms(startedAt));
            addArtifacts(renumberArtifacts(extracted.artifacts, artifacts.length));
            for (const next of htmlActionUrls(raw, finalUrl, experiment)) {
              if (queuedUrls.size >= experiment.maxPages) break;
              paginationExecuted = true;
              await enqueue(next);
            }
          } finally {
            hostActive.set(currentHost, Math.max(0, (hostActive.get(currentHost) ?? 1) - 1));
          }
        },
      },
      config,
    );

    await crawler.run();
    throwIfCancelled(input.signal);
    if (pagesRequested >= experiment.maxPages) paginationStopReason = "page_cap";
    else if (artifacts.length >= experiment.maxRequests) paginationStopReason = "request_cap";
    else paginationStopReason = paginationExecuted ? "no_growth" : "no_page_param";

    let browserPages = 0;
    let actionsDiscovered = 0;
    let actionsExecuted = 0;
    let browserEscalated = false;
    if (!input.staticArtifactsSufficient(artifacts) && experiment.browserAllowed) {
      attemptedLayers.push("crawlee playwright");
      browserEscalated = true;
      const browserResult = await this.runBrowserEscalation({
        input,
        experiment,
        limits,
        startedAt,
        nextArtifactIndex: artifacts.length,
      });
      addArtifacts(browserResult.artifacts);
      throwIfCancelled(input.signal);
      requestsMade += browserResult.requestsMade;
      browserPages += browserResult.browserPages;
      actionsDiscovered += browserResult.actionsDiscovered;
      actionsExecuted += browserResult.actionsExecuted;
      if (browserResult.actionsExecuted > 0) {
        paginationExecuted = true;
        paginationStopReason = browserResult.stopReason;
      }
    } else if (!experiment.browserAllowed) {
      skippedLayers.push("crawlee playwright skipped because browser observation is disabled by manifest");
    } else {
      skippedLayers.push("crawlee playwright skipped because HTTP artifacts were sufficient");
    }

    const checkpoint = await saveRuntimeCheckpoint({
      rootDir: input.checkpointDir ? path.resolve(input.checkpointDir) : undefined,
      experiment,
      budget: input.budget,
      artifacts,
    });
    await queue.drop().catch(() => undefined);

    return {
      runtime: this.name,
      artifacts,
      diagnostics: {
        finalUrl,
        attemptedLayers,
        skippedLayers,
        requestsMade,
        pagesRequested,
        paginationExecuted,
        paginationStopReason,
        browserPages,
        bytesInspected: artifacts.reduce((total, artifact) => total + artifact.byteSize, 0),
        rssLinks: [],
        sitemapLinks: [],
        runtime: this.name,
        queueRequestsAdded,
        queueDuplicateRequests,
        retriesAttempted,
        browserEscalated,
        actionsDiscovered,
        actionsExecuted,
        checkpointLoaded: checkpoint.loaded,
        checkpointSaved: checkpoint.saved,
      },
    };
  }

  private async runBrowserEscalation(input: {
    input: CrawlRuntimeInput;
    experiment: SourceExperiment;
    limits: RuntimeLimits;
    startedAt: number;
    nextArtifactIndex: number;
  }): Promise<{
    artifacts: AcquiredArtifact[];
    requestsMade: number;
    browserPages: number;
    actionsDiscovered: number;
    actionsExecuted: number;
    stopReason: NonNullable<AcquisitionDiagnostics["paginationStopReason"]>;
  }> {
    const artifacts: AcquiredArtifact[] = [];
    let requestsMade = 0;
    let browserPages = 0;
    let actionsDiscovered = 0;
    let actionsExecuted = 0;
    let stopReason: NonNullable<AcquisitionDiagnostics["paginationStopReason"]> = "no_growth";
    const config = crawleeConfig();
    const queue = await RequestQueue.open(`scraper-v2-browser-${hash([input.experiment.inputUrl, Date.now(), Math.random()])}`, { config });
    await queue.addRequest({ url: input.experiment.inputUrl, uniqueKey: input.experiment.inputUrl });

    const addDomSnapshot = async (context: PlaywrightCrawlingContext): Promise<void> => {
      if (artifacts.length + input.nextArtifactIndex >= input.experiment.maxRequests) return;
      const html = await context.page.content();
      if (byteLength(html) > input.experiment.maxPayloadBytes) return;
      artifacts.push(
        makeArtifact({
          kind: "dom_snapshot",
          index: input.nextArtifactIndex + artifacts.length,
          sourceUrl: context.page.url(),
          contentType: "text/html",
          payload: {
            title: await context.page.title().catch(() => ""),
            textLength: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length,
            html,
          },
          rawBytes: byteLength(html),
          acquisitionMode: "browser",
          timingMs: ms(input.startedAt),
        }),
      );
    };

    const crawler = new PlaywrightCrawler(
      {
        requestQueue: queue,
        maxRequestsPerCrawl: 1,
        minConcurrency: 1,
        maxConcurrency: 1,
        maxRequestRetries: input.limits.maxRequestRetries,
        navigationTimeoutSecs: input.limits.navigationTimeoutSecs,
        requestHandlerTimeoutSecs: input.limits.requestHandlerTimeoutSecs,
        headless: true,
        preNavigationHooks: [
          async (context, gotoOptions) => {
            throwIfCancelled(input.input.signal);
            gotoOptions.waitUntil = "networkidle";
            gotoOptions.timeout = input.limits.navigationTimeoutSecs * 1000;
            context.page.on("response", (response) => {
              void (async () => {
                if (artifacts.length + input.nextArtifactIndex >= input.experiment.maxRequests) return;
                if (!shouldCaptureNetworkResponse(response, input.experiment.allowedOrigins)) return;
                requestsMade += 1;
                const text = await response.text().catch(() => "");
                if (!text || byteLength(text) > input.experiment.maxPayloadBytes) return;
                const payload = parseJsonSafe(text, input.experiment.maxPayloadBytes);
                if (payload === undefined) return;
                artifacts.push(
                  makeArtifact({
                    kind: "network_json",
                    index: input.nextArtifactIndex + artifacts.length,
                    sourceUrl: response.url(),
                    contentType: response.headers()["content-type"],
                    payload,
                    rawBytes: byteLength(text),
                    acquisitionMode: "browser",
                    timingMs: ms(input.startedAt),
                  }),
                );
              })();
            });
          },
        ],
        async requestHandler(context: PlaywrightCrawlingContext) {
          throwIfCancelled(input.input.signal);
          browserPages += 1;
          await context.page.waitForTimeout(500);
          await addDomSnapshot(context);
          for (let transition = 0; transition < input.limits.browserActionTransitions; transition += 1) {
            if (artifacts.length + input.nextArtifactIndex >= input.experiment.maxRequests) {
              stopReason = "request_cap";
              break;
            }
            const beforeUrl = context.page.url();
            const beforeHtml = await context.page.content();
            const actions = enumerateCandidateActionsFromHtml(beforeHtml, beforeUrl)
              .filter((action) =>
                !action.disabled &&
                action.confidence >= 0.55 &&
                (action.proposedEffect === "next_page" ||
                  action.proposedEffect === "load_more" ||
                  action.proposedEffect === "infinite_scroll") &&
                (!action.href || isSafePublicOrigin(action.href, input.experiment.allowedOrigins))
              );
            actionsDiscovered += actions.length;
            const action = actions[0];
            if (!action) break;
            if (action.href) {
              await context.page.goto(action.href, { waitUntil: "networkidle", timeout: input.limits.navigationTimeoutSecs * 1000 });
            } else if (action.proposedEffect === "infinite_scroll") {
              await context.page.mouse.wheel(0, 5000);
              await context.page.waitForTimeout(800);
            } else {
              const actionIndex = Number(action.elementId.split(":")[1]) - 1;
              await context.page.evaluate((index) => {
                const elements = [...document.querySelectorAll("a[href],button,[role='button'],[role='link'],select,input[type='button'],input[type='submit']")];
                (elements[index] as HTMLElement | undefined)?.click();
              }, actionIndex);
              await context.page.waitForLoadState("networkidle", { timeout: input.limits.navigationTimeoutSecs * 1000 }).catch(() => undefined);
            }
            await context.page.waitForTimeout(500);
            const afterHtml = await context.page.content();
            const changed = hash(beforeHtml) !== hash(afterHtml) || beforeUrl !== context.page.url();
            if (!changed) {
              stopReason = "no_growth";
              break;
            }
            actionsExecuted += 1;
            browserPages += 1;
            await addDomSnapshot(context);
          }
        },
      },
      config,
    );

    await crawler.run();
    await queue.drop().catch(() => undefined);
    return { artifacts, requestsMade, browserPages, actionsDiscovered, actionsExecuted, stopReason };
  }
}
