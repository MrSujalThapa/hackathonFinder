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
  /** Set when the match was inferred from unstructured source evidence. */
  inferredFromEvidence?: boolean;
};

const GTA_RE =
  /\b(toronto|mississauga|brampton|markham|scarborough|north york|etobicoke|vaughan|richmond hill|oakville|burlington|ajax|pickering|oshawa|greater toronto|gta)\b/;
const TORONTO_RE = /\btoronto\b/;
const WATERLOO_RE = /\bwaterloo\b/;
const WATERLOO_NEARBY_RE = /\b(kitchener|cambridge|guelph|kw|k-w|waterloo region)\b/;
const ONTARIO_NEARBY_RE = /\b(waterloo|kitchener|hamilton|guelph|london|ottawa|ontario)\b/;
const SAN_FRANCISCO_RE = /\b(san\s+francisco|bay\s+area|\bsf\b)/;
const CALIFORNIA_BROAD_RE = /\b(california|united states|usa|u\.s\.a\.|u\.s\.)\b/;
const VIRTUAL_RE = /\b(online|virtual|remote|worldwide|global|anywhere)\b/;

type ExplicitCity = "toronto" | "waterloo" | "mississauga" | "san francisco";

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
  if (/\bsan\s+francisco\b|\bsf\s+bay\s+area\b|\bbay\s+area\b|\bsf\b/i.test(command)) {
    return "san francisco";
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
      // GTA proximity is not a verified contradiction of an explicit Toronto
      // query — retain for review instead of hard-rejecting.
      return {
        status: "GTA_MATCH",
        eligible: true,
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

  if (city === "san francisco") {
    if (SAN_FRANCISCO_RE.test(text)) {
      return {
        status: "EXACT_MATCH",
        eligible: true,
        needsReview: false,
        reason: "San Francisco location match",
      };
    }
    if (CALIFORNIA_BROAD_RE.test(text) && !SAN_FRANCISCO_RE.test(text)) {
      return {
        status: "MISMATCH",
        eligible: false,
        needsReview: false,
        reason: "Broad California/US location is not San Francisco",
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
    // Unresolvable location metadata is not a verified contradiction — retain
    // for review instead of rejecting.
    return {
      status: "UNKNOWN",
      eligible: true,
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
      reason: `Location mismatch for explicit ${city} query`,
    };
  }

  return {
    status: "UNKNOWN",
    eligible: true,
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

/**
 * Region knowledge for dynamic (non-hardcoded) location queries. The parser is
 * untouched: this only interprets `preferences.locations` produced upstream.
 */
const REGION_ALIASES: Record<string, string> = {
  ontario: "ontario",
  quebec: "quebec",
  qc: "quebec",
  "british columbia": "british columbia",
  bc: "british columbia",
  california: "california",
};

const CITY_TO_REGION: Record<string, string> = {
  toronto: "ontario",
  ottawa: "ontario",
  mississauga: "ontario",
  waterloo: "ontario",
  hamilton: "ontario",
  london: "ontario",
  kingston: "ontario",
  kitchener: "ontario",
  guelph: "ontario",
  markham: "ontario",
  vaughan: "ontario",
  scarborough: "ontario",
  montreal: "quebec",
  "quebec city": "quebec",
  laval: "quebec",
  vancouver: "british columbia",
  victoria: "british columbia",
  burnaby: "british columbia",
  richmond: "british columbia",
  surrey: "british columbia",
  "san francisco": "california",
  "los angeles": "california",
  "san diego": "california",
  "san jose": "california",
  oakland: "california",
};

function wordIn(text: string, token: string): boolean {
  return new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
}

function structuredLocationText(event: HackathonEvent): string {
  return normalizeText(
    [
      event.location,
      event.city,
      event.region,
      event.country,
      event.eventLocation?.city,
      event.eventLocation?.region,
      event.eventLocation?.country,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function unstructuredEvidenceText(event: HackathonEvent): string {
  return normalizeText(
    [
      event.name,
      event.description,
      event.eventLocation?.rawText,
      event.eventLocation?.venue,
      ...event.evidence.map((item) => `${item.title ?? ""} ${item.snippet ?? ""}`),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function isUnknownLocationText(text: string): boolean {
  return !text || text === "unknown" || text.includes("location unclear");
}

/** A verified concrete place exists when structured fields name somewhere real. */
export function hasVerifiedConcreteLocation(event: HackathonEvent): boolean {
  const text = structuredLocationText(event);
  if (isUnknownLocationText(text)) return false;
  if (VIRTUAL_RE.test(text)) return false;
  return text.trim().length > 0;
}

const REGION_COUNTRY: Record<string, string> = {
  ontario: "canada",
  quebec: "canada",
  "british columbia": "canada",
  california: "united states",
};

function countryKey(raw: string | undefined): string | null {
  const text = normalizeText(raw ?? "");
  if (!text) return null;
  if (text.includes("canada")) return "canada";
  if (
    text === "usa" ||
    text.includes("united states") ||
    /\bu\.?\s*s\.?\s*a\.?\b/.test(text) ||
    text.includes("america")
  ) {
    return "united states";
  }
  return text;
}

function eventCountry(event: HackathonEvent): string | undefined {
  return event.country ?? event.eventLocation?.country;
}

/**
 * Verifiably in-person: an in-person mode marker plus a concrete named place
 * (city field, known city, or multi-part venue). Unknown-modality events stay
 * soft so remote-only queries send them to review instead of rejecting.
 */
export function isVerifiedInPersonEvent(event: HackathonEvent): boolean {
  const inPerson =
    event.mode === "in-person" || event.eventLocation?.mode === "in_person";
  if (!inPerson) return false;
  const structured = structuredLocationText(event);
  if (isUnknownLocationText(structured) || VIRTUAL_RE.test(structured)) return false;
  const cityField = normalizeText(event.city ?? event.eventLocation?.city ?? "");
  if (cityField && cityField !== "unknown") return true;
  if (Object.keys(CITY_TO_REGION).some((city) => wordIn(structured, city))) return true;
  return (event.location ?? "").split(",").length >= 2;
}

function firstLocationPart(event: HackathonEvent): string {
  return normalizeText((event.location ?? "").split(",")[0] ?? "");
}

function mismatchReason(requested: string, actual: string): string {
  return `Location mismatch: ${actual || "unspecified venue"} is not ${requested}`;
}

function splitRequestedLocations(preferences: DiscoveryPreferences): {
  cities: string[];
  regions: string[];
  other: string[];
} {
  const cities: string[] = [];
  const regions: string[] = [];
  const other: string[] = [];
  for (const raw of preferences.locations) {
    const normalized = normalizeText(raw);
    if (!normalized) continue;
    if (CITY_TO_REGION[normalized]) {
      cities.push(normalized);
      continue;
    }
    if (REGION_ALIASES[normalized]) {
      regions.push(REGION_ALIASES[normalized]);
      continue;
    }
    // Unknown phrasing (e.g. an arbitrary city the parser captured) is treated
    // as a strict city-like token: verified match accepts, verified conflict
    // rejects, unknown stays for review.
    other.push(normalized);
  }
  return { cities, regions, other };
}

function matchEvidenceToken(event: HackathonEvent, tokens: string[]): string | null {
  const evidence = unstructuredEvidenceText(event);
  for (const token of tokens) {
    if (token && wordIn(evidence, token)) return token;
  }
  return null;
}

/**
 * Dynamic location verification for event-location queries without a hardcoded
 * explicit city. Strict city: verified match accepts, verified conflict
 * rejects, unknown (or evidence-only) stays for review unless unstructured
 * source evidence makes the location inferable. Province: city-in-region or
 * region match accepts, conflicting region rejects, unknown stays for review.
 */
export function classifyDynamicLocationQuery(
  event: HackathonEvent,
  preferences: DiscoveryPreferences,
): LocationConstraintResult | null {
  if ((preferences.locationConstraint ?? "none") !== "event_location") return null;
  const { cities, regions, other } = splitRequestedLocations(preferences);
  const strictTokens = [...cities, ...other];
  if (strictTokens.length === 0 && regions.length === 0) return null;

  const structured = structuredLocationText(event);
  const requestedLabel = [...cities, ...other, ...regions].join(", ") || "requested location";

  if (strictTokens.length > 0) {
    const matchedCity = strictTokens.find((token) => wordIn(structured, token));
    if (matchedCity) {
      return {
        status: "EXACT_MATCH",
        eligible: true,
        needsReview: false,
        reason: `Verified ${matchedCity} location match`,
      };
    }
    // Verified conflict: a different known city, an explicit city field, or a
    // multi-part venue that names somewhere else. Country-only, venue-only, or
    // empty locations cannot confirm or deny the city, so they stay for review.
    const cityField = normalizeText(event.city ?? event.eventLocation?.city ?? "");
    const differentKnownCity =
      Object.keys(CITY_TO_REGION).find(
        (city) => !strictTokens.includes(city) && wordIn(structured, city),
      ) ?? (cityField && cityField !== "unknown" ? cityField : undefined);
    if (differentKnownCity) {
      return {
        status: "MISMATCH",
        eligible: false,
        needsReview: false,
        reason: mismatchReason(requestedLabel, differentKnownCity),
      };
    }
    const firstPart = firstLocationPart(event);
    const knownRegions = [...new Set([...Object.values(REGION_ALIASES), ...regions])];
    if (
      firstPart &&
      !strictTokens.some((token) => wordIn(firstPart, token)) &&
      !regions.some((region) => wordIn(firstPart, region)) &&
      !knownRegions.some((region) => wordIn(firstPart, region)) &&
      (event.location ?? "").includes(",")
    ) {
      return {
        status: "MISMATCH",
        eligible: false,
        needsReview: false,
        reason: mismatchReason(requestedLabel, structured),
      };
    }
    const inferred = matchEvidenceToken(event, strictTokens);
    if (inferred) {
      return {
        status: "EXACT_MATCH",
        eligible: true,
        needsReview: false,
        reason: `Location inferred from source evidence for ${inferred}`,
        inferredFromEvidence: true,
      };
    }
    // Cannot confirm or deny the requested city — retain for review rather
    // than treating missing/ambiguous location metadata as a contradiction.
    return {
      status: "UNKNOWN",
      eligible: true,
      needsReview: true,
      reason: `Location unclear for explicit ${requestedLabel} query`,
    };
  }

  // Province/state query.
  const matchedRegion = regions.find((region) => wordIn(structured, region));
  if (matchedRegion) {
    return {
      status: "EXACT_MATCH",
      eligible: true,
      needsReview: false,
      reason: `Verified ${matchedRegion} region match`,
    };
  }
  // Conflicting region/city and incompatible country reject before
  // city-in-region matching: "London, UK" must not match Ontario via London.
  const country = countryKey(eventCountry(event));
  const wantedCountries = [...new Set(regions.map((region) => REGION_COUNTRY[region]).filter(Boolean))];
  const eventRegion = Object.values(REGION_ALIASES).find((region) => wordIn(structured, region));
  const eventCityRegion = Object.entries(CITY_TO_REGION).find(([city]) => wordIn(structured, city));
  if ((eventRegion && !regions.includes(eventRegion)) || (eventCityRegion && !regions.includes(eventCityRegion[1]))) {
    const actual = eventCityRegion ? `${eventCityRegion[0]} (${eventCityRegion[1]})` : (eventRegion ?? structured);
    return {
      status: "MISMATCH",
      eligible: false,
      needsReview: false,
      reason: mismatchReason(requestedLabel, actual),
    };
  }
  if (country && wantedCountries.length > 0 && !wantedCountries.includes(country)) {
    return {
      status: "MISMATCH",
      eligible: false,
      needsReview: false,
      reason: mismatchReason(requestedLabel, country),
    };
  }
  const cityInRegion = Object.entries(CITY_TO_REGION).find(
    ([city, region]) => regions.includes(region) && wordIn(structured, city),
  );
  if (cityInRegion) {
    return {
      status: "EXACT_MATCH",
      eligible: true,
      needsReview: false,
      reason: `Verified ${cityInRegion[0]} within ${cityInRegion[1]}`,
    };
  }
  // Country compatibility: a compatible country (Canada for Ontario) without
  // city detail cannot confirm or deny the region, so it stays for review;
  // an incompatible country is a verified conflict.
  if (country) {
    if (wantedCountries.length > 0 && !wantedCountries.includes(country)) {
      return {
        status: "MISMATCH",
        eligible: false,
        needsReview: false,
        reason: mismatchReason(requestedLabel, country),
      };
    }
    const inferredFromCompatible =
      matchEvidenceToken(event, regions) ??
      Object.entries(CITY_TO_REGION).find(
        ([city, region]) => regions.includes(region) && wordIn(unstructuredEvidenceText(event), city),
      )?.[0];
    if (inferredFromCompatible) {
      return {
        status: "EXACT_MATCH",
        eligible: true,
        needsReview: false,
        reason: `Location inferred from source evidence for ${inferredFromCompatible}`,
        inferredFromEvidence: true,
      };
    }
    return {
      status: "UNKNOWN",
      eligible: true,
      needsReview: true,
      reason: `Location unclear for explicit ${requestedLabel} query`,
    };
  }
  if (hasVerifiedConcreteLocation(event)) {
    // A multi-part venue names a concrete place that matched nothing above,
    // so it conflicts. A single-part venue cannot be placed, so it falls
    // through to evidence inference or review.
    if ((event.location ?? "").includes(",")) {
      return {
        status: "MISMATCH",
        eligible: false,
        needsReview: false,
        reason: mismatchReason(requestedLabel, structured),
      };
    }
  }
  const inferredRegion = matchEvidenceToken(event, regions);
  if (inferredRegion) {
    return {
      status: "EXACT_MATCH",
      eligible: true,
      needsReview: false,
      reason: `Location inferred from source evidence for ${inferredRegion}`,
      inferredFromEvidence: true,
    };
  }
  const inferredCity = Object.entries(CITY_TO_REGION).find(
    ([city, region]) => regions.includes(region) && wordIn(unstructuredEvidenceText(event), city),
  );
  if (inferredCity) {
    return {
      status: "EXACT_MATCH",
      eligible: true,
      needsReview: false,
      reason: `Location inferred from source evidence: ${inferredCity[0]} within ${inferredCity[1]}`,
      inferredFromEvidence: true,
    };
  }
  return {
    status: "UNKNOWN",
    eligible: true,
    needsReview: true,
    reason: `Location unclear for explicit ${requestedLabel} query`,
  };
}

/**
 * Human-inspectable note for matches verified through unstructured source
 * evidence (or region mapping) so accepted results explain themselves.
 */
export function locationMatchNote(
  event: HackathonEvent,
  preferences: DiscoveryPreferences,
): string | null {
  const result = classifyDynamicLocationQuery(event, preferences);
  if (!result || !result.eligible || result.needsReview) return null;
  if (result.inferredFromEvidence) return result.reason;
  if (result.status === "EXACT_MATCH" && result.reason.includes("within")) return result.reason;
  return null;
}
