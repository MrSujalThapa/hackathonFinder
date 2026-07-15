import * as cheerio from "cheerio";
import { performance } from "node:perf_hooks";
import type { StructuredArtifact, StructuredArtifactKind } from "@/experiments/scraper-v2/types";
import { DEVFOLIO_CONFIG } from "@/experiments/scraper-v2/devfolioConfig";

const MAX_PAYLOAD_BYTES = 5_000_000;

export type ArtifactAcquisitionResult = {
  finalUrl: string;
  htmlBytes: number;
  artifacts: StructuredArtifact[];
  requestsMade: number;
  mode: "static" | "browser";
  durationMs: number;
};

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function parseJsonSafe(raw: string): unknown | undefined {
  const trimmed = raw.trim();
  if (!trimmed || byteLength(trimmed) > MAX_PAYLOAD_BYTES) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function artifact(
  kind: StructuredArtifactKind,
  label: string,
  sourceUrl: string,
  raw: string,
): StructuredArtifact | undefined {
  const payload = parseJsonSafe(raw);
  if (payload === undefined) return undefined;
  return {
    kind,
    label,
    sourceUrl,
    payload,
    byteLength: byteLength(raw),
  };
}

export async function acquireStructuredArtifacts(
  url = DEVFOLIO_CONFIG.listingUrl,
): Promise<ArtifactAcquisitionResult> {
  const startedAt = performance.now();
  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": "hackathon-finder-shadow-experiment/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`Devfolio artifact request failed: ${response.status}`);
  }

  const finalUrl = response.url || url;
  const html = await response.text();
  const $ = cheerio.load(html);
  const artifacts: StructuredArtifact[] = [];

  const nextData = $("#__NEXT_DATA__").first().html();
  if (nextData) {
    const found = artifact("next_data", "__NEXT_DATA__", finalUrl, nextData);
    if (found) artifacts.push(found);
  }

  $("script[type='application/ld+json']").each((index, element) => {
    const found = artifact("json_ld", `json_ld_${index}`, finalUrl, $(element).html() ?? "");
    if (found) artifacts.push(found);
  });

  $("script").each((index, element) => {
    const type = ($(element).attr("type") ?? "").toLowerCase();
    if (type && type !== "application/json") return;
    const text = $(element).html() ?? "";
    if (!/[{[]/.test(text) || !/hackathon|devfolio|apollo|props|pageProps/i.test(text)) {
      return;
    }
    const found = artifact("embedded_json", `script_json_${index}`, finalUrl, text);
    if (found) artifacts.push(found);
  });

  return {
    finalUrl,
    htmlBytes: byteLength(html),
    artifacts,
    requestsMade: 1,
    mode: "static",
    durationMs: Math.round(performance.now() - startedAt),
  };
}
