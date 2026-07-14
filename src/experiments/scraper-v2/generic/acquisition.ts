import * as cheerio from "cheerio";
import { performance } from "node:perf_hooks";
import { withPlaywright } from "@/lib/browser/playwright";
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

function parseJsonSafe(raw: string, maxPayloadBytes: number): unknown | undefined {
  const trimmed = raw.trim();
  if (!trimmed || byteLength(trimmed) > maxPayloadBytes) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function makeArtifact(input: {
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

function extractStaticArtifacts(
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
): Promise<{ artifacts: AcquiredArtifact[]; requestsMade: number; browserPages: number; durationMs: number; skippedReason?: string }> {
  if (!experiment.browserAllowed) {
    return {
      artifacts: [],
      requestsMade: 0,
      browserPages: 0,
      durationMs: 0,
      skippedReason: "browser observation disabled by manifest",
    };
  }
  const startedAt = performance.now();
  const artifacts: AcquiredArtifact[] = [];
  let observedRequests = 0;

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
      const html = await page.content();
      if (byteLength(html) <= experiment.maxPayloadBytes) {
        artifacts.push(
          makeArtifact({
            kind: "dom_snapshot",
            index: nextArtifactIndex + artifacts.length,
            sourceUrl: page.url(),
            contentType: "text/html",
            payload: {
              title: await page.title().catch(() => ""),
              textLength: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length,
            },
            rawBytes: byteLength(html),
            acquisitionMode: "browser",
            timingMs: ms(startedAt),
          }),
        );
      }
    },
    { timeoutMs: 25_000, headless: true },
  );

  return {
    artifacts,
    requestsMade: observedRequests,
    browserPages: 1,
    durationMs: ms(startedAt),
  };
}

export async function acquireGenericArtifacts(
  experiment: SourceExperiment,
  shouldUseBrowser: (artifacts: AcquiredArtifact[]) => boolean,
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

  attemptedLayers.push("framework state");
  if (shouldUseBrowser(artifacts)) {
    attemptedLayers.push("browser observation");
    const observed = await observeBrowserArtifacts(experiment, artifacts.length);
    artifacts = artifacts.concat(observed.artifacts).slice(0, experiment.maxRequests);
    requestsMade += observed.requestsMade;
    browserPages += observed.browserPages;
    if (observed.skippedReason) skippedLayers.push(observed.skippedReason);
  } else {
    skippedLayers.push("browser observation skipped because static artifacts were sufficient");
  }

  skippedLayers.push("general repeated-DOM inference not implemented in Phase 3B");

  return {
    artifacts,
    diagnostics: {
      finalUrl,
      attemptedLayers,
      skippedLayers,
      requestsMade,
      browserPages,
      bytesInspected: artifacts.reduce((total, artifact) => total + artifact.byteSize, 0),
      rssLinks: staticResult.rssLinks,
      sitemapLinks: staticResult.sitemapLinks,
      canonicalUrl: staticResult.canonicalUrl
        ? new URL(staticResult.canonicalUrl, finalUrl).toString()
        : undefined,
    },
  };
}
