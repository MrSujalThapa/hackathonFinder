import * as cheerio from "cheerio";
import { performance } from "node:perf_hooks";
import { withPlaywright } from "@/lib/browser/playwright";
import { enumerateCandidateActionsFromHtml } from "@/experiments/scraper-v2/generic/browserActions";
import type {
  AcquiredArtifact,
  AcquiredArtifactKind,
  AcquisitionDiagnostics,
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

function visibleIdentityEstimate(html: string, baseUrl: string): number {
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
  return identities.size;
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
      skippedReason: "browser observation disabled by manifest",
    };
  }
  const startedAt = performance.now();
  const artifacts: AcquiredArtifact[] = [];
  let observedRequests = 0;
  let browserPages = 0;
  let actionsDiscovered = 0;
  let actionsExecuted = 0;
  const identitiesAfterActions: number[] = [];
  const attemptedActionIds = new Set<string>();

  async function captureDomSnapshot(input: {
    page: {
      content(): Promise<string>;
      title(): Promise<string>;
    };
    sourceUrl: string;
  }): Promise<string> {
    const html = await input.page.content();
    if (byteLength(html) <= experiment.maxPayloadBytes) {
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

      await page.goto(experiment.inputUrl, { waitUntil: "networkidle", timeout: 20_000 });
      await page.waitForTimeout(750);
      browserPages += 1;
      let html = await captureDomSnapshot({ page, sourceUrl: page.url() });
      let previousFingerprint = pageFingerprint(html);
      const maxActions = Math.max(0, experiment.maxBrowserActions ?? 0);

      for (let transition = 0; transition < maxActions; transition += 1) {
        if (artifacts.length + nextArtifactIndex >= experiment.maxRequests) break;
        const effectPriority: Record<string, number> = {
          load_more: 4,
          next_page: 3,
          infinite_scroll: 2,
          open_detail: 1,
        };
        const actions = enumerateCandidateActionsFromHtml(html, page.url())
          .filter(
            (action) =>
              !action.disabled &&
              !attemptedActionIds.has(action.elementId) &&
              action.confidence >= 0.55 &&
              (action.proposedEffect === "next_page" ||
                action.proposedEffect === "load_more" ||
                action.proposedEffect === "infinite_scroll" ||
                action.proposedEffect === "open_detail") &&
              (!action.href || isSafePublicOrigin(action.href, experiment.allowedOrigins)),
          )
          .sort((left, right) => (effectPriority[right.proposedEffect] ?? 0) - (effectPriority[left.proposedEffect] ?? 0) || right.confidence - left.confidence);
        actionsDiscovered += actions.length;
        const action = actions[0];
        if (!action) break;
        attemptedActionIds.add(action.elementId);
        if (action.href && (action.proposedEffect === "next_page" || action.proposedEffect === "open_detail")) {
          await page.goto(action.href, { waitUntil: "networkidle", timeout: 20_000 }).catch(() => undefined);
        } else if (action.proposedEffect === "infinite_scroll") {
          await page.mouse.wheel(0, 5000);
          await page.waitForTimeout(900);
        } else {
          const actionIndex = Number(action.elementId.split(":")[1]) - 1;
          await page.evaluate((index) => {
            const elements = [...document.querySelectorAll("a[href],button,[role='button'],[role='link'],select,input[type='button'],input[type='submit']")];
            (elements[index] as HTMLElement | undefined)?.click();
          }, actionIndex);
          await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined);
          await page.waitForTimeout(500);
        }
        html = await captureDomSnapshot({ page, sourceUrl: page.url() });
        const nextFingerprint = pageFingerprint(html);
        const identityEstimate = visibleIdentityEstimate(html, page.url());
        if (nextFingerprint === previousFingerprint) continue;
        previousFingerprint = nextFingerprint;
        actionsExecuted += 1;
        browserPages += 1;
        identitiesAfterActions.push(identityEstimate);
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
          finalUrl: experiment.inputUrl,
          attemptedLayers: [...attemptedLayers, "browser observation"],
          skippedLayers: [
            "static structured parsing skipped because static response was not OK",
            "static structured parsing produced no safe public artifacts",
          ],
          requestsMade: 1 + browserFallback.requestsMade,
          browserPages: browserFallback.browserPages,
          bytesInspected: browserFallback.artifacts.reduce((total, artifact) => total + artifact.byteSize, 0),
          blockedReason: undefined,
          rssLinks: [],
          sitemapLinks: [],
          actionsDiscovered: browserFallback.actionsDiscovered,
          actionsExecuted: browserFallback.actionsExecuted,
          identitiesAfterActions: browserFallback.identitiesAfterActions,
        },
      };
    }
    return {
      artifacts: [],
      diagnostics: {
        finalUrl: response.url || experiment.inputUrl,
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
      finalUrl,
      attemptedLayers,
      skippedLayers,
      requestsMade,
      pagesRequested,
      paginationExecuted: paginated.artifacts.length > 0 || actionsExecuted > 0,
      paginationStopReason: actionsExecuted > 0 && paginationStopReason === "no_page_param" ? "no_growth" : paginationStopReason,
      browserPages,
      actionsDiscovered,
      actionsExecuted,
      identitiesAfterActions,
      bytesInspected: artifacts.reduce((total, artifact) => total + artifact.byteSize, 0),
      rssLinks: staticResult.rssLinks,
      sitemapLinks: staticResult.sitemapLinks,
      canonicalUrl: staticResult.canonicalUrl
        ? new URL(staticResult.canonicalUrl, finalUrl).toString()
        : undefined,
    },
  };
}
