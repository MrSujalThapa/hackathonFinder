import type { EventPageClassification, HackathonEvent } from "@/core/discovery/types";

export type ClassifyEventPageInput = {
  name?: string;
  url?: string;
  title?: string;
  description?: string;
  text?: string;
  startDate?: string;
  endDate?: string;
  deadline?: string;
  location?: string;
  mode?: string;
  applyUrl?: string;
  officialUrl?: string;
  source?: string;
};

export type ClassifyEventPageResult = {
  classification: EventPageClassification;
  reasons: string[];
  confidence: "low" | "medium" | "high";
};

const DIRECTORY_HOST_PATH =
  /mlh\.(io|com)\/?(seasons|events)?\/?$|mlh\.(io|com)\/seasons\/\d+\/events\/?$|devpost\.com\/hackathons|devpost\.com\/hackathons\/search|lablab\.ai\/(ai-hackathons|events)\/?$|eventbrite\.[^/]+\/d\/|eventbrite\.[^/]+\/.*\/hackathon|unstop\.com\/hackathons|hackathon\.com\/?$|lu\.ma\/calendar\/?|lu\.ma\/discover\/?/i;

const DIRECTORY_TITLE =
  /\b(hackathons?|events?)\b.*\b(directory|listing|browse|search|category|categories|platform|upcoming|calendar)\b|\b(events?\s+calendar|search results?|profiles?|portfolio)\b|\b(major league hacking|ai hackathons|machine learning\/ai)\b|\bon\s+devpost\b|\blablab\.ai\b/i;

const ARTICLE_HINT =
  /\b(what is a hackathon|how to (win|prepare)|tips for|recap|wrap[- ]?up|listicle|best hackathons of|top \d+ hackathons|wikipedia)\b/i;

const ORG_HINT =
  /\b(about us|our mission|careers|company home|organization homepage)\b/i;

const MULTI_EVENT_HINT =
  /\b(upcoming hackathons|featured hackathons|all hackathons|browse hackathons|hackathon calendar)\b/i;

const HISTORICAL_HINT =
  /\b(recap|winners? announced|completed|archives?|past event|previously held)\b/i;

const GENERIC_SOCIAL_TITLE =
  /^(facebook|instagram|linkedin|x|twitter|devpost|luma|lu\.ma)$/i;

const SOCIAL_OR_PROFILE_HOST_PATH =
  /(^|\.)facebook\.com\/?$|(^|\.)facebook\.com\/(profile\.php|people|groups|pages|events|search)\/?|(^|\.)instagram\.com\/?$|(^|\.)linkedin\.com\/?$|(^|\.)linkedin\.com\/(in|company|school|feed|search)\/?|(^|\.)x\.com\/?$|(^|\.)twitter\.com\/?$|devpost\.com\/[^/?#]+\/?$|devpost\.com\/software\/[^/?#]+\/?$/i;

function hostnamePath(url?: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function hasSpecificTitle(name?: string): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length < 6) return false;
  if (/^(hackathons?|events?|ai|ml|home)$/i.test(trimmed)) return false;
  if (DIRECTORY_TITLE.test(trimmed) && !/\b20\d{2}\b/.test(trimmed)) return false;
  return true;
}

function hasConcreteDate(input: ClassifyEventPageInput): boolean {
  return Boolean(input.startDate || input.endDate || input.deadline);
}

function hasPlaceOrMode(input: ClassifyEventPageInput): boolean {
  return Boolean(
    input.mode ||
      input.location ||
      /\b(online|remote|toronto|waterloo|canada|in[- ]?person)\b/i.test(
        [input.description, input.text, input.location].filter(Boolean).join(" "),
      ),
  );
}

function hasApplySignal(input: ClassifyEventPageInput): boolean {
  const blob = [input.applyUrl, input.description, input.text, input.title]
    .filter(Boolean)
    .join(" ");
  return Boolean(input.applyUrl) || /\b(apply|register|registration|sign\s*up)\b/i.test(blob);
}

function isGenericSocialOrProfilePage(
  input: ClassifyEventPageInput,
  urlKey: string,
  title: string,
  body: string,
): boolean {
  if (GENERIC_SOCIAL_TITLE.test(title.trim())) return true;
  if (!SOCIAL_OR_PROFILE_HOST_PATH.test(urlKey)) return false;
  if (hasConcreteDate(input) || /\b(hackathons?|apply|register|deadline)\b/i.test(body)) {
    return false;
  }
  return true;
}

/**
 * Deterministic page/event classifier used before scoring.
 */
export function classifyEventPage(input: ClassifyEventPageInput): ClassifyEventPageResult {
  const reasons: string[] = [];
  const urlKey = hostnamePath(input.url ?? input.officialUrl);
  const title = input.name ?? input.title ?? "";
  const body = [title, input.description, input.text].filter(Boolean).join(" ");

  if (DIRECTORY_HOST_PATH.test(urlKey) || DIRECTORY_TITLE.test(title) || MULTI_EVENT_HINT.test(body)) {
    reasons.push("Looks like a directory/category/listing page");
    return { classification: "EVENT_DIRECTORY", reasons, confidence: "high" };
  }

  if (isGenericSocialOrProfilePage(input, urlKey, title, body)) {
    reasons.push("Looks like a generic social/profile page, not a concrete event");
    return { classification: "UNCERTAIN", reasons, confidence: "high" };
  }

  if (ARTICLE_HINT.test(body)) {
    reasons.push("Looks like an article, tip list, or recap");
    return { classification: "ARTICLE", reasons, confidence: "high" };
  }

  if (ORG_HINT.test(body) && !hasConcreteDate(input)) {
    reasons.push("Looks like an organization homepage");
    return { classification: "ORGANIZATION_PAGE", reasons, confidence: "medium" };
  }

  if (HISTORICAL_HINT.test(body) && !hasApplySignal(input)) {
    reasons.push("Looks like a historical/recap page");
    return { classification: "HISTORICAL_EVENT", reasons, confidence: "medium" };
  }

  const signals = [
    hasSpecificTitle(title),
    hasConcreteDate(input),
    hasApplySignal(input),
    hasPlaceOrMode(input),
    Boolean(input.officialUrl || input.url),
    Boolean(input.description || input.text),
  ].filter(Boolean).length;

  if (signals >= 4 && hasSpecificTitle(title) && hasConcreteDate(input)) {
    reasons.push(`Strong individual-event signals (${signals}/6)`);
    return { classification: "INDIVIDUAL_EVENT", reasons, confidence: "high" };
  }

  if (signals >= 3 && hasSpecificTitle(title)) {
    reasons.push(`Likely individual event (${signals}/6 signals)`);
    return { classification: "INDIVIDUAL_EVENT", reasons, confidence: "medium" };
  }

  if (signals >= 2) {
    reasons.push(`Uncertain event identity (${signals}/6 signals)`);
    return { classification: "UNCERTAIN", reasons, confidence: "low" };
  }

  reasons.push("Insufficient evidence of an individual event");
  return { classification: "UNCERTAIN", reasons, confidence: "low" };
}

export function classifyHackathonEvent(event: HackathonEvent): ClassifyEventPageResult {
  return classifyEventPage({
    name: event.name,
    url: event.officialUrl ?? event.applyUrl ?? event.socialUrl,
    title: event.name,
    description: event.description,
    text: event.description,
    startDate: event.startDate,
    endDate: event.endDate,
    deadline: event.deadline,
    location: event.location ?? [event.city, event.country].filter(Boolean).join(", "),
    mode: event.mode,
    applyUrl: event.applyUrl,
    officialUrl: event.officialUrl,
    source: event.source,
  });
}

export function shouldEnterNormalScoring(
  classification: EventPageClassification,
): boolean {
  return classification === "INDIVIDUAL_EVENT";
}
