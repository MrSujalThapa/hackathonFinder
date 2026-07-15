import * as cheerio from "cheerio";
import { performance } from "node:perf_hooks";
import type { Page } from "playwright";
import { withPlaywright } from "@/lib/browser/playwright";
import { enumerateCandidateActionsFromHtml, verifyActionStateProgression } from "@/experiments/scraper-v2/generic/browserActions";
import type {
  AcquiredArtifact,
  AcquiredArtifactKind,
  AcquisitionDiagnostics,
  CandidateAction,
  SourceExperiment,
} from "@/experiments/scraper-v2/generic/types";
import { byteLength, isPlainRecord, isSafePublicOrigin } from "@/experiments/scraper-v2/generic/valueUtils";

export type GenericAcquisitionResult = {
  artifacts: AcquiredArtifact[];
  diagnostics: AcquisitionDiagnostics;
};

type MinimalResponse = {
  url(): string;
  status(): number;
  headers(): Record<string, string>;
  request(): {
    method(): string;
    resourceType(): string;
  };
  text(): Promise<string>;
};

function ms(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

export function parseJsonSafe(raw: string, maxPayloadBytes: number): unknown | undefined {
  const trimmed = raw.trim();
  if (!trimmed || byteLength(trimmed) > maxPayloadBytes) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export function makeArtifact(input: {
  kind: AcquiredArtifactKind;
  index: number;
  sourceUrl: string;
  contentType?: string;
  payload: unknown;
  rawBytes: number;
  acquisitionMode: "static" | "browser";
  timingMs: number;
}): AcquiredArtifact {
  return {
    artifactId: `${input.kind}:${input.index}`,
    kind: input.kind,
    sourceUrl: input.sourceUrl,
    contentType: input.contentType,
    payload: input.payload,
    byteSize: input.rawBytes,
    acquisitionMode: input.acquisitionMode,
    timingMs: input.timingMs,
  };
}

function extractBalancedJsonFragments(scriptText: string, maxPayloadBytes: number): unknown[] {
  const out: unknown[] = [];
  const starts = [...scriptText.matchAll(/[{[]/g)].map((match) => match.index ?? 0).slice(0, 40);
  for (const start of starts) {
    const opening = scriptText[start];
    const closing = opening === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < scriptText.length; index += 1) {
      const char = scriptText[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }
      if (char === "\"") {
        inString = true;
        continue;
      }
      if (char === opening) depth += 1;
      if (char === closing) depth -= 1;
      if (depth === 0) {
        const candidate = scriptText.slice(start, index + 1);
        const parsed = parseJsonSafe(candidate, maxPayloadBytes);
        if (parsed !== undefined) out.push(parsed);
        break;
      }
    }
    if (out.length >= 8) break;
  }
  return out;
}

function looksLikeFrameworkState(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  const text = JSON.stringify(value).slice(0, 8_000);
  return /pageProps|dehydrated|queries|loaderData|apollo|relay|router|routes|props|state/i.test(text);
}

function artifactKindForScript(id: string, payload: unknown): AcquiredArtifactKind {
  if (id === "__NEXT_DATA__") return "next_data";
  if (looksLikeFrameworkState(payload)) return "router_data";
  return "embedded_json";
}

function payloadFingerprint(payload: unknown): string {
  return JSON.stringify(payload).slice(0, 10_000);
}

function pageFingerprint(html: string): string {
  return html.replace(/\s+/g, " ").slice(0, 20_000);
}

function actionStateFingerprint(html: string, baseUrl: string): string {
  const identities = [...visibleIdentityKeys(html, baseUrl)].sort();
  if (identities.length > 0) return identities.join("\n").slice(0, 20_000);
  return pageFingerprint(html);
}

function visibleIdentityKeys(html: string, baseUrl: string): Set<string> {
  const $ = cheerio.load(html);
  const identities = new Set<string>();
  $("a[href],article,[role='article'],li,section,div")
    .toArray()
    .slice(0, 400)
    .forEach((element) => {
      const text = $(element).text().replace(/\s+/g, " ").trim();
      const href = $(element).is("a[href]") ? $(element).attr("href") : $(element).find("a[href]").first().attr("href");
      if (!/\b(hackathon|challenge|event|deadline|register|apply|prize|build)\b/i.test(text)) return;
      const dateSignal = /\b(?:20\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(text);
      const title = text.slice(0, 120);
      const resolved = href ? new URL(href, baseUrl).toString() : "";
      identities.add(`${resolved}|${title}|${dateSignal ? "dated" : "undated"}`);
    });
  return identities;
}

function detectBlockedStateFromHtml(html: string): string | undefined {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2_000);
  const eventWordCount = (text.match(/hackathon|challenge|event|deadline|register|apply|prize|build/gi) ?? []).length;
  if (eventWordCount < 3 && /\b(404|page not found|not found|route not found|couldn't find|cannot find)\b/i.test(text)) {
    return "stale_or_missing_route";
  }
  if (eventWordCount < 3 && /confirm you are human|security check before continuing|captcha|cf-challenge|awswaf/i.test(text)) {
    return "human_verification";
  }
  if (eventWordCount < 3 && /access denied|temporarily blocked|unusual traffic|forbidden/i.test(text)) {
    return "blocked";
  }
  return undefined;
}

type BrowserObservationSample = NonNullable<AcquisitionDiagnostics["browserObservation"]>["domSamples"][number];
type BrowserObservation = NonNullable<AcquisitionDiagnostics["browserObservation"]>;

type PageLike = {
  url(): string;
  content(): Promise<string>;
  title(): Promise<string>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
};

async function sampleBrowserDom(page: PageLike, label: string): Promise<BrowserObservationSample & {
  frameworkHydrationDetected: boolean;
  iframes: number;
  openShadowRoots: number;
  loadingOverlayDetected: boolean;
  blockedState?: string;
}> {
  const data = await page.evaluate(() => {
    const text = document.body?.innerText ?? "";
    const elements = [...document.querySelectorAll("body *")] as HTMLElement[];
    const visible = elements.filter((element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const scrollContainers = elements.filter((element) => {
      const style = getComputedStyle(element);
      return element.scrollHeight > element.clientHeight + 80 && /(auto|scroll|overlay)/i.test(style.overflowY);
    });
    const loadingOverlay = visible.some((element) =>
      /\b(loading|please wait|checking|security check|verify|captcha)\b/i.test(element.innerText ?? ""),
    );
    return {
      nodeCount: elements.length,
      textLength: text.replace(/\s+/g, " ").trim().length,
      eventWordCount: (text.match(/hackathon|challenge|event|deadline|register|apply|prize|build/gi) ?? []).length,
      scrollContainerCount: scrollContainers.length,
      frameworkHydrationDetected: Boolean(
        (window as unknown as { __NEXT_DATA__?: unknown }).__NEXT_DATA__ ||
          document.querySelector("[data-reactroot],#__next,#root,[data-rsc]"),
      ),
      iframes: document.querySelectorAll("iframe").length,
      openShadowRoots: elements.filter((element) => element.shadowRoot).length,
      loadingOverlayDetected: loadingOverlay,
    };
  });
  const html = await page.content();
  return {
    label,
    nodeCount: data.nodeCount,
    textLength: data.textLength,
    eventWordCount: data.eventWordCount,
    scrollContainerCount: data.scrollContainerCount,
    frameworkHydrationDetected: data.frameworkHydrationDetected,
    iframes: data.iframes,
    openShadowRoots: data.openShadowRoots,
    loadingOverlayDetected: data.loadingOverlayDetected,
    ...(detectBlockedStateFromHtml(html) ? { blockedState: detectBlockedStateFromHtml(html) } : {}),
  };
}

async function waitForDomStability(page: PageLike, samples: BrowserObservationSample[]): Promise<void> {
  let previous = "";
  let stable = 0;
  for (let index = 0; index < 5; index += 1) {
    await page.waitForTimeout(index === 0 ? 600 : 900);
    const html = await page.content();
    const fingerprint = pageFingerprint(html);
    const sample = await sampleBrowserDom(page, `stability-${index + 1}`);
    samples.push(sample);
    if (fingerprint === previous) stable += 1;
    else stable = 0;
    previous = fingerprint;
    if (stable >= 1 && sample.eventWordCount > 0) return;
    if (sample.blockedState) return;
  }
}

async function scrollNestedContainers(page: PageLike): Promise<number> {
  return page.evaluate(() => {
    const elements = [...document.querySelectorAll("body *")] as HTMLElement[];
    const scrollers = elements.filter((element) => {
      const style = getComputedStyle(element);
      return element.scrollHeight > element.clientHeight + 80 && /(auto|scroll|overlay)/i.test(style.overflowY);
    }).slice(0, 6);
    for (const element of scrollers) {
      element.scrollTop = Math.min(element.scrollTop + element.clientHeight * 1.5, element.scrollHeight);
    }
    return scrollers.length;
  });
}

function actionPriority(action: CandidateAction): number {
  const effectPriority: Record<string, number> = {
    load_more: 5,
    next_page: 4,
    infinite_scroll: 3,
    change_filter: 2,
    change_sort: 2,
    open_detail: 1,
  };
  return (effectPriority[action.proposedEffect] ?? 0) * 10 + action.confidence;
}

async function executeCandidateAction(page: Page, action: CandidateAction): Promise<void> {
  if (action.href && (action.proposedEffect === "next_page" || action.proposedEffect === "open_detail")) {
    await page.goto(action.href, { waitUntil: "networkidle", timeout: 20_000 }).catch(() => undefined);
    return;
  }
  if (action.proposedEffect === "infinite_scroll") {
    await page.mouse.wheel(0, 5000);
    await page.waitForTimeout(900);
    return;
  }
  if (action.role && action.accessibleName && page.getByRole) {
    const clicked = await page
      .getByRole(action.role as Parameters<Page["getByRole"]>[0], { name: action.accessibleName, exact: true })
      .first()
      .click({ timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
    if (clicked) {
      await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      return;
    }
  }
  const actionIndex = Number(action.elementId.split(":")[1]) - 1;
  await page.evaluate((index) => {
    const elements = [...document.querySelectorAll("a[href],button,[role='button'],[role='link'],select,input[type='button'],input[type='submit']")];
    (elements[index] as HTMLElement | undefined)?.click();
  }, actionIndex);
  await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

function numericPageParam(url: string): { param: string; page: number } | undefined {
  try {
    const parsed = new URL(url);
    for (const param of ["page", "p"]) {
      const value = parsed.searchParams.get(param);
      if (!value) continue;
      const page = Number(value);
      if (Number.isInteger(page) && page >= 1) return { param, page };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function largestArrayLength(value: unknown, depth = 0): number {
  if (depth > 5 || value == null) return 0;
  if (Array.isArray(value)) {
    return Math.max(value.length, ...value.slice(0, 8).map((item) => largestArrayLength(item, depth + 1)));
  }
  if (typeof value !== "object") return 0;
  return Math.max(0, ...Object.values(value as Record<string, unknown>).map((child) => largestArrayLength(child, depth + 1)));
}

function eventPayloadScore(value: unknown): number {
  const text = JSON.stringify(value).slice(0, 20_000).toLowerCase();
  let score = 0;
  if (/\b(hackathon|challenge|event|competition|summit|workshop)\b/.test(text)) score += 3;
  if (/\b(title|name|url|href|slug)\b/.test(text)) score += 1;
  if (/\b(start|date|deadline|submission|open|upcoming|location|venue)\b/.test(text)) score += 2;
  if (/\b(organization|theme|eligibility)\b/.test(text) && !/\b(submission|deadline|location)\b/.test(text)) score -= 2;
  return score;
}

export async function acquirePageParamArtifacts(input: {
  experiment: SourceExperiment;
  artifacts: AcquiredArtifact[];
  nextArtifactIndex: number;
}): Promise<{
  artifacts: AcquiredArtifact[];
  requestsMade: number;
  pagesRequested: number;
  stopReason: NonNullable<AcquisitionDiagnostics["paginationStopReason"]>;
}> {
  if (input.experiment.maxPages <= 1 || input.artifacts.length >= input.experiment.maxRequests) {
    return { artifacts: [], requestsMade: 0, pagesRequested: 1, stopReason: "page_cap" };
  }

  const seed = input.artifacts
    .filter((artifact) =>
      artifact.kind !== "html" &&
      artifact.kind !== "dom_snapshot" &&
      largestArrayLength(artifact.payload) >= 2 &&
      isSafePublicOrigin(artifact.sourceUrl, input.experiment.allowedOrigins)
    )
    .sort((left, right) => {
      const networkPriority = Number(right.kind === "network_json") - Number(left.kind === "network_json");
      if (networkPriority !== 0) return networkPriority;
      const eventPriority = eventPayloadScore(right.payload) - eventPayloadScore(left.payload);
      if (eventPriority !== 0) return eventPriority;
      return largestArrayLength(right.payload) - largestArrayLength(left.payload);
    })[0];
  if (!seed) {
    return { artifacts: [], requestsMade: 0, pagesRequested: 1, stopReason: "no_page_param" };
  }
  const pageParam = numericPageParam(seed.sourceUrl) ?? { param: "page", page: 1 };

  const seenFingerprints = new Set(input.artifacts.map((artifact) => payloadFingerprint(artifact.payload)));
  const out: AcquiredArtifact[] = [];
  let requestsMade = 0;
  let pagesRequested = 1;
  let stopReason: NonNullable<AcquisitionDiagnostics["paginationStopReason"]> = "page_cap";

  for (let page = pageParam.page + 1; page <= input.experiment.maxPages; page += 1) {
    if (input.nextArtifactIndex + out.length >= input.experiment.maxRequests) {
      stopReason = "request_cap";
      break;
    }
    const url = new URL(seed.sourceUrl);
    url.searchParams.set(pageParam.param, String(page));
    if (!isSafePublicOrigin(url.toString(), input.experiment.allowedOrigins)) {
      stopReason = "fetch_failed";
      break;
    }
    pagesRequested += 1;
    requestsMade += 1;
    const startedAt = performance.now();
    const response = await fetch(url, {
      headers: {
        accept: "application/json, text/plain, */*",
        "user-agent": "hackathon-finder-structured-v2-experiment/1.0",
      },
    }).catch(() => undefined);
    if (!response?.ok) {
      stopReason = "fetch_failed";
      break;
    }
    const text = await response.text().catch(() => "");
    if (!text || byteLength(text) > input.experiment.maxPayloadBytes) {
      stopReason = "fetch_failed";
      break;
    }
    const payload = parseJsonSafe(text, input.experiment.maxPayloadBytes);
    if (payload === undefined) {
      stopReason = "fetch_failed";
      break;
    }
    const fingerprint = payloadFingerprint(payload);
    if (seenFingerprints.has(fingerprint)) {
      stopReason = "no_growth";
      break;
    }
    seenFingerprints.add(fingerprint);
    out.push(
      makeArtifact({
        kind: "network_json",
        index: input.nextArtifactIndex + out.length,
        sourceUrl: response.url || url.toString(),
        contentType: response.headers.get("content-type") ?? undefined,
        payload,
        rawBytes: byteLength(text),
        acquisitionMode: "static",
        timingMs: ms(startedAt),
      }),
    );
  }

  return { artifacts: out, requestsMade, pagesRequested, stopReason };
}

export function extractStaticArtifacts(
  html: string,
  finalUrl: string,
  experiment: SourceExperiment,
  staticTimingMs: number,
): {
  artifacts: AcquiredArtifact[];
  canonicalUrl?: string;
  rssLinks: string[];
  sitemapLinks: string[];
} {
  const $ = cheerio.load(html);
  const artifacts: AcquiredArtifact[] = [
    makeArtifact({
      kind: "html",
      index: 0,
      sourceUrl: finalUrl,
      contentType: "text/html",
      payload: {
        title: $("title").text().trim(),
        bodyTextLength: $("body").text().replace(/\s+/g, " ").trim().length,
        html,
      },
      rawBytes: byteLength(html),
      acquisitionMode: "static",
      timingMs: staticTimingMs,
    }),
  ];
  const canonicalUrl = $("link[rel='canonical']").first().attr("href");
  const rssLinks = $("link[type='application/rss+xml'], link[type='application/atom+xml']")
    .toArray()
    .map((element) => new URL($(element).attr("href") ?? "", finalUrl).toString())
    .filter((url) => isSafePublicOrigin(url, experiment.allowedOrigins));
  const sitemapLinks = $("a[href*='sitemap'], link[href*='sitemap']")
    .toArray()
    .map((element) => new URL($(element).attr("href") ?? "", finalUrl).toString())
    .filter((url) => isSafePublicOrigin(url, experiment.allowedOrigins));

  let index = artifacts.length;
  $("script[type='application/ld+json']").each((_scriptIndex, element) => {
    const raw = $(element).html() ?? "";
    const payload = parseJsonSafe(raw, experiment.maxPayloadBytes);
    if (payload === undefined) return;
    artifacts.push(
      makeArtifact({
        kind: "json_ld",
        index,
        sourceUrl: finalUrl,
        contentType: "application/ld+json",
        payload,
        rawBytes: byteLength(raw),
        acquisitionMode: "static",
        timingMs: staticTimingMs,
      }),
    );
    index += 1;
  });

  $("script").each((_scriptIndex, element) => {
    const id = ($(element).attr("id") ?? "").trim();
    const type = ($(element).attr("type") ?? "").toLowerCase();
    const raw = $(element).html() ?? "";
    if (!raw || byteLength(raw) > experiment.maxPayloadBytes) return;
    const directJson =
      id === "__NEXT_DATA__" || /application\/(?:json|ld\+json)/i.test(type)
        ? parseJsonSafe(raw, experiment.maxPayloadBytes)
        : undefined;
    const fragments = directJson === undefined
      ? extractBalancedJsonFragments(raw, experiment.maxPayloadBytes).filter(looksLikeFrameworkState)
      : [directJson];

    for (const payload of fragments) {
      artifacts.push(
        makeArtifact({
          kind: artifactKindForScript(id, payload),
          index,
          sourceUrl: finalUrl,
          contentType: type || undefined,
          payload,
          rawBytes: byteLength(JSON.stringify(payload)),
          acquisitionMode: "static",
          timingMs: staticTimingMs,
        }),
      );
      index += 1;
    }
  });

  return { artifacts, canonicalUrl, rssLinks, sitemapLinks };
}

export function shouldCaptureNetworkResponse(
  response: Pick<MinimalResponse, "url" | "status" | "headers" | "request">,
  allowedOrigins: string[],
): boolean {
  const request = response.request();
  if (request.method().toUpperCase() !== "GET") return false;
  if (response.status() >= 400) return false;
  if (!isSafePublicOrigin(response.url(), allowedOrigins)) return false;
  const contentType = response.headers()["content-type"] ?? "";
  if (!/json|graphql|text\/plain|application\/octet-stream/i.test(contentType)) return false;
  return true;
}

async function observeBrowserArtifacts(
  experiment: SourceExperiment,
  nextArtifactIndex: number,
): Promise<{
  artifacts: AcquiredArtifact[];
  requestsMade: number;
  browserPages: number;
  durationMs: number;
  actionsDiscovered: number;
  actionsExecuted: number;
  identitiesAfterActions: number[];
  identityGrowthAfterActions: number[];
  actionTrace: NonNullable<AcquisitionDiagnostics["actionTrace"]>;
  browserObservation?: BrowserObservation;
  skippedReason?: string;
}> {
  if (!experiment.browserAllowed) {
    return {
      artifacts: [],
      requestsMade: 0,
      browserPages: 0,
      durationMs: 0,
      actionsDiscovered: 0,
      actionsExecuted: 0,
      identitiesAfterActions: [],
      identityGrowthAfterActions: [],
      actionTrace: [],
      skippedReason: "browser observation disabled by manifest",
    };
  }
  const startedAt = performance.now();
  const artifacts: AcquiredArtifact[] = [];
  let observedRequests = 0;
  let browserPages = 0;
  let actionsDiscovered = 0;
  let actionsExecuted = 0;
  const actionTrace: NonNullable<AcquisitionDiagnostics["actionTrace"]> = [];
  const identitiesAfterActions: number[] = [];
  const identityGrowthAfterActions: number[] = [];
  const attemptedFingerprintByAction = new Map<string, string>();
  const seenIdentityKeys = new Set<string>();
  const domSamples: BrowserObservationSample[] = [];
  let networkJsonResponses = 0;
  let observation: BrowserObservation | undefined;

  async function captureDomSnapshot(input: {
    page: {
      content(): Promise<string>;
      title(): Promise<string>;
      screenshot(options: { type: "jpeg"; quality: number; fullPage: boolean; timeout: number }): Promise<Buffer>;
      evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
    };
    sourceUrl: string;
  }): Promise<string> {
    const html = await input.page.content();
    if (byteLength(html) <= experiment.maxPayloadBytes) {
      const screenshot = await input.page.screenshot({ type: "jpeg", quality: 45, fullPage: false, timeout: 5_000 }).catch(() => undefined);
      const visualNodes = await (input.page.evaluate as unknown as (expression: string) => Promise<Array<{
        nodeId: number;
        text: string;
        boundingBox: { x: number; y: number; width: number; height: number };
      }>>)(`(() => {
        const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
        return [...document.querySelectorAll("body *")]
          .map((element, index) => {
            if (/^(script|style|noscript|template|svg|path|meta|link)$/i.test(element.tagName)) return undefined;
            const text = clean(element.innerText);
            if (!text) return undefined;
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            if (element.hidden || element.getAttribute("aria-hidden") === "true" || style.display === "none" || style.visibility === "hidden" || box.width <= 0 || box.height <= 0) return undefined;
            return {
              nodeId: index + 1,
              text: text.slice(0, 180),
              boundingBox: {
                x: Math.round(box.x),
                y: Math.round(box.y),
                width: Math.round(box.width),
                height: Math.round(box.height)
              }
            };
          })
          .filter(Boolean)
          .slice(0, 800);
      })()`).catch(() => []);
      artifacts.push(
        makeArtifact({
          kind: "dom_snapshot",
          index: nextArtifactIndex + artifacts.length,
          sourceUrl: input.sourceUrl,
          contentType: "text/html",
          payload: {
            title: await input.page.title().catch(() => ""),
            textLength: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length,
            html,
            ...(screenshot ? { screenshotBase64: screenshot.toString("base64"), screenshotMediaType: "image/jpeg" } : {}),
            visualNodes,
          },
          rawBytes: byteLength(html),
          acquisitionMode: "browser",
          timingMs: ms(startedAt),
        }),
      );
    }
    return html;
  }

  await withPlaywright(
    async ({ page }) => {
      page.on("response", (response) => {
        void (async () => {
          if (artifacts.length + nextArtifactIndex >= experiment.maxRequests) return;
          if (!shouldCaptureNetworkResponse(response, experiment.allowedOrigins)) return;
          observedRequests += 1;
          const text = await response.text().catch(() => "");
          if (!text || byteLength(text) > experiment.maxPayloadBytes) return;
          const payload = parseJsonSafe(text, experiment.maxPayloadBytes);
          if (payload === undefined) return;
          networkJsonResponses += 1;
          artifacts.push(
            makeArtifact({
              kind: "network_json",
              index: nextArtifactIndex + artifacts.length,
              sourceUrl: response.url(),
              contentType: response.headers()["content-type"],
              payload,
              rawBytes: byteLength(text),
              acquisitionMode: "browser",
              timingMs: ms(startedAt),
            }),
          );
        })();
      });

      const listenersAttachedBeforeNavigation = true;
      await page.goto(experiment.inputUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
      domSamples.push(await sampleBrowserDom(page, "after-domcontentloaded"));
      await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined);
      await waitForDomStability(page, domSamples);
      const scrolledContainers = await scrollNestedContainers(page);
      if (scrolledContainers > 0) {
        await page.waitForTimeout(900);
        domSamples.push(await sampleBrowserDom(page, "after-nested-scroll"));
      }
      const lowSignalSamples = domSamples.filter((sample) => sample.eventWordCount < 3);
      const finalBlockedState = (domSamples.at(-1) as BrowserObservationSample & { blockedState?: string } | undefined)?.blockedState;
      const persistentBlockedState = lowSignalSamples.length === domSamples.length ? finalBlockedState : undefined;
      browserPages += 1;
      let html = await captureDomSnapshot({ page, sourceUrl: page.url() });
      let previousFingerprint = actionStateFingerprint(html, page.url());
      visibleIdentityKeys(html, page.url()).forEach((key) => seenIdentityKeys.add(key));
      const maxActions = Math.max(0, experiment.maxBrowserActions ?? 0);
      observation = {
        listenersAttachedBeforeNavigation,
        initialDocumentUrl: experiment.inputUrl,
        finalRenderedUrl: page.url(),
        domSamples,
        networkJsonResponses,
        frameworkHydrationDetected: domSamples.some((sample) => "frameworkHydrationDetected" in sample),
        nestedScrollContainers: Math.max(0, ...domSamples.map((sample) => sample.scrollContainerCount)),
        iframes: 0,
        openShadowRoots: 0,
        loadingOverlayDetected: false,
        ...(persistentBlockedState ? { blockedState: persistentBlockedState } : {}),
      };

      for (let transition = 0; transition < maxActions; transition += 1) {
        if (artifacts.length + nextArtifactIndex >= experiment.maxRequests) break;
        const actions = enumerateCandidateActionsFromHtml(html, page.url())
          .filter(
            (action) =>
              !action.disabled &&
              action.confidence >= 0.55 &&
              (action.proposedEffect === "next_page" ||
                action.proposedEffect === "load_more" ||
                action.proposedEffect === "infinite_scroll" ||
                action.proposedEffect === "change_filter" ||
                action.proposedEffect === "change_sort") &&
              (!action.href || isSafePublicOrigin(action.href, experiment.allowedOrigins)),
          )
          .sort((left, right) => actionPriority(right) - actionPriority(left));
        actionsDiscovered += actions.length;
        const action = actions[0];
        if (!action) break;
        await executeCandidateAction(page, action);
        await waitForDomStability(page, domSamples);
        const nested = await scrollNestedContainers(page);
        if (nested > 0) {
          await page.waitForTimeout(700);
        }
        html = await captureDomSnapshot({ page, sourceUrl: page.url() });
        const nextFingerprint = actionStateFingerprint(html, page.url());
        const identityKeys = visibleIdentityKeys(html, page.url());
        const progression = verifyActionStateProgression({
          actionId: action.elementId,
          beforeFingerprint: previousFingerprint,
          afterFingerprint: nextFingerprint,
          seenIdentityKeys,
          nextIdentityKeys: identityKeys,
          attemptedFingerprintByAction,
        });
        actionTrace.push({
          actionId: action.elementId,
          effect: action.proposedEffect,
          accepted: progression.accepted,
          newIdentityCount: progression.newIdentityKeys.length,
          rejectedReasons: progression.reasons,
        });
        attemptedFingerprintByAction.set(action.elementId, previousFingerprint);
        if (!progression.accepted) {
          if (action.elementId === "synthetic:scroll") break;
          continue;
        }
        identityKeys.forEach((key) => seenIdentityKeys.add(key));
        previousFingerprint = nextFingerprint;
        actionsExecuted += 1;
        browserPages += 1;
        identitiesAfterActions.push(identityKeys.size);
        identityGrowthAfterActions.push(progression.newIdentityKeys.length);
      }
    },
    { timeoutMs: 25_000, headless: true },
  );

  return {
    artifacts,
    requestsMade: observedRequests,
    browserPages,
    durationMs: ms(startedAt),
    actionsDiscovered,
    actionsExecuted,
    identitiesAfterActions,
    identityGrowthAfterActions,
    actionTrace,
    ...(observation ? { browserObservation: observation } : {}),
  };
}

export async function acquireGenericArtifacts(
  experiment: SourceExperiment,
  staticArtifactsSufficient: (artifacts: AcquiredArtifact[]) => boolean,
): Promise<GenericAcquisitionResult> {
  const attemptedLayers: string[] = [];
  const skippedLayers: string[] = [];
  const startedAt = performance.now();

  attemptedLayers.push("static response");
  const response = await fetch(experiment.inputUrl, {
    method: "GET",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": "hackathon-finder-structured-v2-experiment/1.0",
    },
  });
  if (!response.ok) {
    const browserFallback = await observeBrowserArtifacts(experiment, 0).catch(() => undefined);
    if (browserFallback && browserFallback.artifacts.length > 0) {
      return {
        artifacts: browserFallback.artifacts,
        diagnostics: {
          requestedUrl: experiment.inputUrl,
          finalUrl: experiment.inputUrl,
          httpStatus: response.status,
          attemptedLayers: [...attemptedLayers, "browser observation"],
          skippedLayers: [
            "static structured parsing skipped because static response was not OK",
            "static structured parsing produced no safe public artifacts",
          ],
          requestsMade: 1 + browserFallback.requestsMade,
          browserPages: browserFallback.browserPages,
          bytesInspected: browserFallback.artifacts.reduce((total, artifact) => total + artifact.byteSize, 0),
          rssLinks: [],
          sitemapLinks: [],
          actionsDiscovered: browserFallback.actionsDiscovered,
          actionsExecuted: browserFallback.actionsExecuted,
          identitiesAfterActions: browserFallback.identitiesAfterActions,
          identityGrowthAfterActions: browserFallback.identityGrowthAfterActions,
          actionTrace: browserFallback.actionTrace,
          ...(browserFallback.browserObservation ? { browserObservation: browserFallback.browserObservation } : {}),
          blockedReason: browserFallback.browserObservation?.blockedState,
        },
      };
    }
    return {
      artifacts: [],
      diagnostics: {
        finalUrl: response.url || experiment.inputUrl,
        requestedUrl: experiment.inputUrl,
        httpStatus: response.status,
        attemptedLayers,
        skippedLayers,
        requestsMade: 1,
        browserPages: 0,
        bytesInspected: 0,
        blockedReason: `static response returned ${response.status}`,
        rssLinks: [],
        sitemapLinks: [],
      },
    };
  }

  const finalUrl = response.url || experiment.inputUrl;
  if (!isSafePublicOrigin(finalUrl, experiment.allowedOrigins)) {
    throw new Error(`Final URL escaped allowed origins: ${new URL(finalUrl).origin}`);
  }
  const html = await response.text();
  const staticResult = extractStaticArtifacts(html, finalUrl, experiment, ms(startedAt));
  let artifacts = staticResult.artifacts.slice(0, experiment.maxRequests);
  let requestsMade = 1;
  let browserPages = 0;
  let pagesRequested = 1;
  let paginationStopReason: NonNullable<AcquisitionDiagnostics["paginationStopReason"]> = "not_attempted";
  let actionsDiscovered = 0;
  let actionsExecuted = 0;
  let identitiesAfterActions: number[] = [];
  let identityGrowthAfterActions: number[] = [];
  let actionTrace: NonNullable<AcquisitionDiagnostics["actionTrace"]> = [];
  let browserObservation: BrowserObservation | undefined;

  attemptedLayers.push("framework state");
  if (!staticArtifactsSufficient(artifacts) || (experiment.maxBrowserActions ?? 0) > 0) {
    attemptedLayers.push(staticArtifactsSufficient(artifacts) ? "browser action probe" : "browser observation");
    const observed = await observeBrowserArtifacts(experiment, artifacts.length).catch((error) => {
      skippedLayers.push(
        `browser observation failed: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}`,
      );
      return undefined;
    });
    if (observed) {
      artifacts = artifacts.concat(observed.artifacts).slice(0, experiment.maxRequests);
      requestsMade += observed.requestsMade;
      browserPages += observed.browserPages;
      actionsDiscovered += observed.actionsDiscovered;
      actionsExecuted += observed.actionsExecuted;
      identitiesAfterActions = identitiesAfterActions.concat(observed.identitiesAfterActions);
      identityGrowthAfterActions = identityGrowthAfterActions.concat(observed.identityGrowthAfterActions);
      actionTrace = actionTrace.concat(observed.actionTrace);
      browserObservation = observed.browserObservation;
      if (observed.skippedReason) skippedLayers.push(observed.skippedReason);
    }
  } else {
    skippedLayers.push("browser observation skipped because static artifacts were sufficient");
  }

  attemptedLayers.push("generic page-param pagination");
  const paginated = await acquirePageParamArtifacts({
    experiment,
    artifacts,
    nextArtifactIndex: artifacts.length,
  });
  if (paginated.artifacts.length > 0) {
    artifacts = artifacts.concat(paginated.artifacts).slice(0, experiment.maxRequests);
  } else if (paginated.stopReason === "no_page_param") {
    skippedLayers.push("page-param pagination skipped because no safe numeric page parameter was observed");
  }
  requestsMade += paginated.requestsMade;
  pagesRequested = Math.max(pagesRequested, paginated.pagesRequested);
  paginationStopReason = paginated.stopReason;

  return {
    artifacts,
    diagnostics: {
      requestedUrl: experiment.inputUrl,
      finalUrl,
      httpStatus: response.status,
      attemptedLayers,
      skippedLayers,
      requestsMade,
      pagesRequested: Math.max(pagesRequested, browserPages || 1),
      paginationExecuted: paginated.artifacts.length > 0 || actionsExecuted > 0,
      paginationStopReason: actionsExecuted > 0 && paginationStopReason === "no_page_param" ? "no_growth" : paginationStopReason,
      browserPages,
      actionsDiscovered,
      actionsExecuted,
      identitiesAfterActions,
      identityGrowthAfterActions,
      actionTrace,
      ...(browserObservation ? { browserObservation } : {}),
      ...(browserObservation?.blockedState ? { blockedReason: browserObservation.blockedState } : {}),
      bytesInspected: artifacts.reduce((total, artifact) => total + artifact.byteSize, 0),
      rssLinks: staticResult.rssLinks,
      sitemapLinks: staticResult.sitemapLinks,
      canonicalUrl: staticResult.canonicalUrl
        ? new URL(staticResult.canonicalUrl, finalUrl).toString()
        : undefined,
    },
  };
}
