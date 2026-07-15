import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { CandidateAction } from "@/experiments/scraper-v2/generic/types";
import { normalizeRatio } from "@/experiments/scraper-v2/generic/valueUtils";

type ActionVerificationInput = {
  beforeFingerprint: string;
  afterFingerprint: string;
  previousIdentityCount: number;
  nextIdentityCount: number;
  previousEventQuality: number;
  nextEventQuality: number;
  dateCoverageImproved: boolean;
  usefulRecordsAdded: number;
  navigatedToAllowedOrigin: boolean;
};

function clean(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  return text || undefined;
}

function roleFor($: cheerio.CheerioAPI, element: Element): string | undefined {
  const explicit = clean($(element).attr("role"));
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a") return "link";
  if (tag === "select") return "combobox";
  if (tag === "input") return "textbox";
  return undefined;
}

function accessibleName($: cheerio.CheerioAPI, element: Element): string | undefined {
  const item = $(element);
  return clean(item.attr("aria-label")) ?? clean(item.attr("title")) ?? clean(item.text()) ?? clean(item.attr("value"));
}

function disabled($: cheerio.CheerioAPI, element: Element): boolean {
  const item = $(element);
  const classNames = (item.attr("class") ?? "").split(/\s+/).filter(Boolean);
  return item.attr("disabled") != null ||
    item.attr("aria-disabled") === "true" ||
    item.attr("aria-current") != null ||
    classNames.some((className) => /^(?:disabled|is-disabled|btn-disabled)$/i.test(className));
}

function inferEffect(name: string | undefined, href: string | undefined): CandidateAction["proposedEffect"] {
  const text = `${name ?? ""} ${href ?? ""}`.toLowerCase();
  const controlName = (name ?? "").replace(/\s+/g, " ").trim();
  const explicitPagingLabel = controlName.length <= 80 &&
    /\b(load more|show more|view more|more events|more hackathons|next|older|page\s*\d+)\b/i.test(controlName);
  const pagingHref = href ? /(?:[?&](page|p|offset|cursor)=|\/page\/\d+)/i.test(href) : false;
  if (href && !pagingHref && !explicitPagingLabel) return "open_detail";
  if (/\b(load more|show more|view more|more events|more hackathons)\b/.test(text)) return "load_more";
  if (/\b(next|older|page\s*\d+|[?&](page|p|offset|cursor)=)\b/.test(text)) return "next_page";
  if (/\b(sort|newest|oldest|upcoming|recent)\b/.test(text)) return "change_sort";
  if (/\b(filter|category|type|location|online|virtual|hybrid)\b/.test(text)) return "change_filter";
  if (href && !/[?&](page|p|offset|cursor)=/i.test(href)) return "open_detail";
  return "unknown";
}

function inferContext(name: string | undefined, href: string | undefined, role: string | undefined): CandidateAction["context"] {
  const text = `${name ?? ""} ${href ?? ""} ${role ?? ""}`.toLowerCase();
  const pagingHref = href ? /(?:[?&](page|p|offset|cursor)=|\/page\/\d+)/i.test(href) : false;
  const controlName = (name ?? "").replace(/\s+/g, " ").trim();
  const explicitPagingLabel = controlName.length <= 80 &&
    /\b(next|older|page\s*\d+|load more|show more|view more)\b/i.test(controlName);
  if (/\b(home|about|privacy|terms|sponsor|contact|blog|login|log in|sign in|sign up|register account|profile|portfolio|dashboard|account)\b/.test(text)) {
    return "navigation";
  }
  if (href && !pagingHref && !explicitPagingLabel) {
    return "detail";
  }
  if (/\b(next|previous|pagination|page\s*\d+|load more|show more|cursor|offset)\b/.test(text)) return "pagination";
  if (/\b(filter|category|sort|location|type)\b/.test(text)) return "filter";
  if (/\b(register|apply|details?|view event|learn more)\b/.test(text)) return "detail";
  return "unknown";
}

function confidenceFor(action: CandidateAction): number {
  let score = 0.2;
  if (action.disabled) score -= 0.4;
  if (action.context === "pagination") score += 0.35;
  if (action.context === "detail") score += 0.2;
  if (action.context === "filter") score += 0.1;
  if (action.context === "navigation") score -= 0.35;
  if (action.proposedEffect === "next_page" || action.proposedEffect === "load_more") score += 0.3;
  if (/\b(next|load more|show more|view more|older)\b/i.test(action.accessibleName ?? "")) score += 0.18;
  if (/^(?:page\s*)?\d+$/i.test(action.accessibleName ?? "")) score -= 0.12;
  if (action.proposedEffect === "unknown") score -= 0.15;
  if (action.accessibleName) score += 0.05;
  return normalizeRatio(score);
}

export function enumerateCandidateActionsFromHtml(html: string, baseUrl: string): CandidateAction[] {
  const $ = cheerio.load(html);
  const actions: CandidateAction[] = [];
  $("a[href],button,[role='button'],[role='link'],select,input[type='button'],input[type='submit']")
    .toArray()
    .forEach((element, index) => {
      const name = accessibleName($, element);
      const role = roleFor($, element);
      const rawHref = $(element).attr("href");
      const href = rawHref ? new URL(rawHref, baseUrl).toString() : undefined;
      const action: CandidateAction = {
        elementId: `action:${index + 1}`,
        ...(role ? { role } : {}),
        ...(name ? { accessibleName: name } : {}),
        ...(href ? { href } : {}),
        disabled: disabled($, element),
        context: inferContext(name, href, role),
        proposedEffect: inferEffect(name, href),
        confidence: 0,
      };
      action.confidence = confidenceFor(action);
      if (action.confidence >= 0.25 && action.context !== "navigation") actions.push(action);
    });
  if (html.length > 8_000 && actions.every((action) => action.proposedEffect !== "next_page" && action.proposedEffect !== "load_more")) {
    actions.push({
      elementId: "synthetic:scroll",
      accessibleName: "scroll",
      disabled: false,
      context: "pagination",
      proposedEffect: "infinite_scroll",
      confidence: 0.55,
    });
  }
  return actions.sort((left, right) => right.confidence - left.confidence).slice(0, 20);
}

export function verifyActionResult(input: ActionVerificationInput): {
  accepted: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (!input.navigatedToAllowedOrigin) reasons.push("action navigated outside allowed origins");
  if (input.beforeFingerprint === input.afterFingerprint) reasons.push("record fingerprint did not change");
  if (input.nextIdentityCount <= input.previousIdentityCount) reasons.push("no new stable identities appeared");
  if (input.nextEventQuality + 0.1 < input.previousEventQuality) reasons.push("event quality regressed");
  if (!input.dateCoverageImproved && input.usefulRecordsAdded <= 0) reasons.push("no useful records or date coverage improvement");
  return { accepted: reasons.length === 0, reasons };
}

export function verifyActionStateProgression(input: {
  actionId: string;
  beforeFingerprint: string;
  afterFingerprint: string;
  seenIdentityKeys: Set<string>;
  nextIdentityKeys: Set<string>;
  attemptedFingerprintByAction: Map<string, string>;
}): {
  accepted: boolean;
  newIdentityKeys: string[];
  reasons: string[];
} {
  const reasons: string[] = [];
  if (input.attemptedFingerprintByAction.get(input.actionId) === input.beforeFingerprint) {
    reasons.push("action already attempted for this page fingerprint");
  }
  if (input.beforeFingerprint === input.afterFingerprint) {
    reasons.push("page fingerprint did not change");
  }
  const newIdentityKeys = [...input.nextIdentityKeys].filter((key) => !input.seenIdentityKeys.has(key));
  if (newIdentityKeys.length <= 0) reasons.push("no new stable identities appeared");
  return {
    accepted: reasons.length === 0,
    newIdentityKeys,
    reasons,
  };
}
