import type { DiscoveryPreferences, HackathonEvent } from "@/core/discovery/types";
import { normalizeText } from "@/core/dedupe";

export type LocationConstraintStatus =
  | "EXACT_MATCH"
  | "GTA_MATCH"
  | "ONTARIO_NEARBY"
  | "VIRTUAL"
  | "MISMATCH"
  | "UNKNOWN";

export type LocationConstraintResult = {
  status: LocationConstraintStatus;
  eligible: boolean;
  needsReview: boolean;
  reason: string;
};

const GTA_RE =
  /\b(toronto|mississauga|brampton|markham|scarborough|north york|etobicoke|vaughan|richmond hill|oakville|burlington|ajax|pickering|oshawa|greater toronto|gta)\b/;
const TORONTO_RE = /\btoronto\b/;
const ONTARIO_NEARBY_RE = /\b(waterloo|kitchener|hamilton|guelph|london|ottawa|ontario)\b/;
const VIRTUAL_RE = /\b(online|virtual|remote|worldwide|global|anywhere)\b/;

function eventLocationText(event: HackathonEvent): string {
  return normalizeText(
    [event.location, event.city, event.country, event.mode].filter(Boolean).join(" "),
  );
}

export function hasExplicitTorontoConstraint(preferences: DiscoveryPreferences): boolean {
  return /\b(?:in|near|around|for)\s+toronto\b|\btoronto\b/i.test(preferences.rawCommand);
}

export function classifyExplicitTorontoLocation(
  event: HackathonEvent,
  preferences: DiscoveryPreferences,
): LocationConstraintResult {
  if (!hasExplicitTorontoConstraint(preferences)) {
    return {
      status: "UNKNOWN",
      eligible: true,
      needsReview: false,
      reason: "No explicit Toronto constraint",
    };
  }

  const text = eventLocationText(event);
  const isVirtual =
    event.mode === "online" ||
    VIRTUAL_RE.test(text) ||
    (event.mode === "hybrid" && VIRTUAL_RE.test(text));
  if (isVirtual) {
    return {
      status: "VIRTUAL",
      eligible: true,
      needsReview: false,
      reason: "Virtual event satisfies explicit Toronto query",
    };
  }

  if (!text || text === "unknown" || text.includes("location unclear")) {
    return {
      status: "UNKNOWN",
      eligible: true,
      needsReview: true,
      reason: "Location unclear for explicit Toronto query",
    };
  }

  if (TORONTO_RE.test(text)) {
    return {
      status: "EXACT_MATCH",
      eligible: true,
      needsReview: false,
      reason: "Toronto location match",
    };
  }

  if (GTA_RE.test(text)) {
    return {
      status: "GTA_MATCH",
      eligible: true,
      needsReview: false,
      reason: "Greater Toronto Area location match",
    };
  }

  if (ONTARIO_NEARBY_RE.test(text) || (text.includes("canada") && text.includes("ontario"))) {
    return {
      status: "ONTARIO_NEARBY",
      eligible: true,
      needsReview: true,
      reason: "Ontario nearby location for explicit Toronto query",
    };
  }

  const hasConcreteLocation =
    Boolean(event.location || event.city || event.country) &&
    !text.includes("remote") &&
    !text.includes("online");
  if (hasConcreteLocation) {
    return {
      status: "MISMATCH",
      eligible: false,
      needsReview: false,
      reason: "Location mismatch for explicit Toronto query",
    };
  }

  return {
    status: "UNKNOWN",
    eligible: true,
    needsReview: true,
    reason: "Location unclear for explicit Toronto query",
  };
}
