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
const WATERLOO_RE = /\bwaterloo\b/;
const WATERLOO_NEARBY_RE = /\b(kitchener|cambridge|guelph|kw|k-w|waterloo region)\b/;
const ONTARIO_NEARBY_RE = /\b(waterloo|kitchener|hamilton|guelph|london|ottawa|ontario)\b/;
const VIRTUAL_RE = /\b(online|virtual|remote|worldwide|global|anywhere)\b/;

type ExplicitCity = "toronto" | "waterloo" | "mississauga";

function eventLocationText(event: HackathonEvent): string {
  return normalizeText(
    [event.location, event.city, event.country, event.mode].filter(Boolean).join(" "),
  );
}

export function hasExplicitTorontoConstraint(preferences: DiscoveryPreferences): boolean {
  return /\b(?:in|near|around|for)\s+toronto\b|\btoronto\b/i.test(preferences.rawCommand);
}

function allowsGta(preferences: DiscoveryPreferences): boolean {
  return /\b(?:gta|greater toronto)\b/i.test(preferences.rawCommand);
}

function explicitCityConstraint(preferences: DiscoveryPreferences): ExplicitCity | null {
  const command = preferences.rawCommand;
  if (/\b(?:gta|greater toronto)\b/i.test(command)) {
    return "toronto";
  }
  for (const city of ["toronto", "waterloo", "mississauga"] as const) {
    if (new RegExp(`\\b(?:in|near|around|for)\\s+${city}\\b|\\b${city}\\b`, "i").test(command)) {
      return city;
    }
  }
  return null;
}

export function hasExplicitCityConstraint(preferences: DiscoveryPreferences): boolean {
  return explicitCityConstraint(preferences) !== null;
}

function classifyConcreteCity(
  city: ExplicitCity,
  text: string,
): Pick<LocationConstraintResult, "status" | "eligible" | "needsReview" | "reason"> | null {
  if (city === "toronto") {
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
        eligible: false,
        needsReview: true,
        reason: "Greater Toronto Area location match",
      };
    }
    if (ONTARIO_NEARBY_RE.test(text) || (text.includes("canada") && text.includes("ontario"))) {
      return {
        status: "ONTARIO_NEARBY",
        eligible: false,
        needsReview: false,
        reason: "Ontario nearby location for explicit Toronto query",
      };
    }
  }

  if (city === "waterloo") {
    if (WATERLOO_RE.test(text)) {
      return {
        status: "EXACT_MATCH",
        eligible: true,
        needsReview: false,
        reason: "Waterloo location match",
      };
    }
    if (WATERLOO_NEARBY_RE.test(text)) {
      return {
        status: "ONTARIO_NEARBY",
        eligible: true,
        needsReview: true,
        reason: "Waterloo-region nearby location for explicit Waterloo query",
      };
    }
  }

  if (city === "mississauga") {
    if (/\bmississauga\b/.test(text)) {
      return {
        status: "EXACT_MATCH",
        eligible: true,
        needsReview: false,
        reason: "Mississauga location match",
      };
    }
    if (GTA_RE.test(text)) {
      return {
        status: "GTA_MATCH",
        eligible: true,
        needsReview: true,
        reason: "GTA nearby location for explicit Mississauga query",
      };
    }
  }

  return null;
}

export function classifyExplicitCityLocation(
  event: HackathonEvent,
  preferences: DiscoveryPreferences,
): LocationConstraintResult {
  const city = explicitCityConstraint(preferences);
  if (!city) {
    return {
      status: "UNKNOWN",
      eligible: true,
      needsReview: false,
      reason: "No explicit city constraint",
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
      eligible: preferences.remotePolicy === "include",
      needsReview: false,
      reason: preferences.remotePolicy === "include"
        ? "Virtual event included by explicit remote policy"
        : "Remote-only event was not requested for this city query",
    };
  }

  if (!text || text === "unknown" || text.includes("location unclear")) {
    return {
      status: "UNKNOWN",
      eligible: false,
      needsReview: true,
      reason: "Location unclear for explicit city query",
    };
  }

  const cityResult = classifyConcreteCity(city, text);
  if (cityResult) {
    if (city === "toronto" && cityResult.status === "GTA_MATCH" && allowsGta(preferences)) {
      return { ...cityResult, eligible: true, needsReview: false };
    }
    return cityResult;
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
      reason: `Location mismatch for explicit ${city[0]!.toUpperCase()}${city.slice(1)} query`,
    };
  }

  return {
    status: "UNKNOWN",
    eligible: false,
    needsReview: true,
    reason: "Location unclear for explicit city query",
  };
}

export function classifyExplicitTorontoLocation(
  event: HackathonEvent,
  preferences: DiscoveryPreferences,
): LocationConstraintResult {
  return classifyExplicitCityLocation(event, preferences);
}
