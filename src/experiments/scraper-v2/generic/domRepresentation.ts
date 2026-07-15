import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type {
  AcquiredArtifact,
  DomNodeSummary,
  DomRepresentation,
} from "@/experiments/scraper-v2/generic/types";

const MAX_NODES = 3_000;
const MAX_DEPTH = 18;
const MAX_TEXT_SAMPLE = 180;

const DATE_PATTERN =
  /\b(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+20\d{2})\b/gi;
const LOCATION_PATTERN =
  /\b(?:online|virtual|hybrid|remote|in-person|onsite|[A-Z][a-z]+,\s*[A-Z][a-z]+|[A-Z][a-z]+\s*,\s*[A-Z]{2})\b/g;

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function classShape(value: string | undefined): string {
  const tokens = (value ?? "")
    .split(/\s+/)
    .map((token) =>
      token
        .replace(/[a-f0-9]{6,}/gi, "#")
        .replace(/\d+/g, "n")
        .replace(/__[a-z0-9_-]+/gi, "__x"),
    )
    .filter(Boolean)
    .slice(0, 8);
  return tokens.join(".");
}

function urlPattern(hrefs: string[]): string | undefined {
  const first = hrefs[0];
  if (!first) return undefined;
  try {
    const parsed = new URL(first, "https://example.invalid");
    return `${parsed.pathname.split("/").filter(Boolean).slice(0, 2).join("/")}${parsed.search ? "?query" : ""}`;
  } catch {
    return first.replace(/[a-z0-9-]{6,}/gi, ":slug").slice(0, 80);
  }
}

function fingerprint(input: {
  tag: string;
  role?: string;
  classShapeValue: string;
  anchorCount: number;
  imageCount: number;
  childTags: string[];
}): string {
  return [
    input.tag,
    input.role ?? "",
    input.classShapeValue,
    `a${Math.min(input.anchorCount, 3)}`,
    `i${Math.min(input.imageCount, 3)}`,
    input.childTags.slice(0, 8).join(","),
  ].join("|");
}

function htmlFromArtifact(artifact: AcquiredArtifact): string | undefined {
  if (artifact.kind !== "html" && artifact.kind !== "dom_snapshot") return undefined;
  const payload = artifact.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const html = (payload as Record<string, unknown>).html;
  return typeof html === "string" ? html : undefined;
}

function isExcludedTag(tag: string): boolean {
  return /^(script|style|noscript|template|svg|path|meta|link)$/i.test(tag);
}

function isHidden($: cheerio.CheerioAPI, node: Element): boolean {
  const element = $(node);
  const style = element.attr("style") ?? "";
  return (
    element.attr("hidden") != null ||
    element.attr("aria-hidden") === "true" ||
    /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)
  );
}

export function buildDomRepresentations(artifacts: AcquiredArtifact[]): DomRepresentation[] {
  const representations: DomRepresentation[] = [];
  for (const artifact of artifacts) {
    const html = htmlFromArtifact(artifact);
    if (!html) continue;
    const $ = cheerio.load(html);
    const nodes: DomNodeSummary[] = [];
    const nodeIds = new WeakMap<Element, number>();

    function visit(node: Element, depth: number, parentId: number | undefined, siblingIndex: number): number | undefined {
      if (nodes.length >= MAX_NODES || depth > MAX_DEPTH || isExcludedTag(node.tagName) || isHidden($, node)) {
        return undefined;
      }
      const nodeId = nodes.length + 1;
      nodeIds.set(node, nodeId);
      const element = $(node);
      const children = element.children().toArray().filter((child): child is Element => child.type === "tag");
      const childTags = children.map((child) => child.tagName.toLowerCase());
      const text = cleanText(element.clone().children().remove().end().text()) || cleanText(element.text());
      const subtreeText = cleanText(element.text());
      const hrefs = element
        .find("a[href]")
        .toArray()
        .map((anchor) => $(anchor).attr("href") ?? "")
        .filter(Boolean)
        .slice(0, 12);
      const headings = element.find("h1,h2,h3,h4,h5,h6,[role='heading']").toArray();
      const headingText = headings.length > 0 ? cleanText($(headings[0]).text()).slice(0, MAX_TEXT_SAMPLE) : undefined;
      const summary: DomNodeSummary = {
        nodeId,
        ...(parentId ? { parentId } : {}),
        tag: node.tagName.toLowerCase(),
        ...(element.attr("role") ? { role: element.attr("role") } : {}),
        depth,
        childCount: children.length,
        classShape: classShape(element.attr("class")),
        ...(text ? { textSample: text.slice(0, MAX_TEXT_SAMPLE) } : {}),
        textLength: subtreeText.length,
        ...(headingText ? { headingText } : {}),
        anchorCount: element.find("a[href]").length + (element.is("a[href]") ? 1 : 0),
        imageCount: element.find("img").length + (element.is("img") ? 1 : 0),
        dateLikeCount: (subtreeText.match(DATE_PATTERN) ?? []).length,
        locationLikeCount: (subtreeText.match(LOCATION_PATTERN) ?? []).length,
        ...(urlPattern(hrefs) ? { urlPattern: urlPattern(hrefs) } : {}),
        siblingIndex,
        visible: true,
        structuralFingerprint: "",
        hrefs,
        childIds: [],
      };
      summary.structuralFingerprint = fingerprint({
        tag: summary.tag,
        role: summary.role,
        classShapeValue: summary.classShape,
        anchorCount: summary.anchorCount,
        imageCount: summary.imageCount,
        childTags,
      });
      nodes.push(summary);
      children.forEach((child, index) => {
        const childId = visit(child, depth + 1, nodeId, index);
        if (childId) summary.childIds.push(childId);
      });
      return nodeId;
    }

    $("body")
      .children()
      .toArray()
      .filter((child): child is Element => child.type === "tag")
      .forEach((node, index) => visit(node, 0, undefined, index));

    representations.push({
      sourceUrl: artifact.sourceUrl,
      artifactId: artifact.artifactId,
      nodeCount: nodes.length,
      maxDepth: Math.max(0, ...nodes.map((node) => node.depth)),
      nodes,
    });
  }
  return representations;
}
