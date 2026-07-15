import type {
  DiscoveryMode,
  DiscoveryProfile,
  DiscoveryPreferences,
  RemotePolicy,
  ReviewPolicy,
  SourceName,
} from "@/core/discovery/types";
import { REAL_DEFAULT_SOURCES } from "@/collectors/types";

const DEFAULT_THEMES: string[] = [];

const LOCATION_ALIASES: Record<string, string> = {
  toronto: "Toronto",
  gta: "Toronto",
  "greater toronto": "Toronto",
  waterloo: "Waterloo",
  mississauga: "Mississauga",
  canada: "Canada",
};

const THEME_ALIASES: Record<string, string> = {
  ai: "AI",
  agent: "agents",
  agents: "agents",
  cloud: "cloud",
  devtools: "developer tools",
  "developer tools": "developer tools",
  fintech: "fintech",
  healthcare: "healthcare",
  cybersecurity: "cybersecurity",
  web3: "web3",
};

const SOURCE_ALIASES: Record<string, SourceName> = {
  hacklist: "hacklist",
  hakku: "hakku",
  devpost: "devpost",
  mlh: "mlh",
  luma: "luma",
  web: "web",
  x: "x",
  mock: "mock",
  twitter: "x",
};

const REVIEW_POLICIES = new Set<ReviewPolicy>(["broad", "balanced", "strict"]);
const PROFILES = new Set<DiscoveryProfile>(["light", "standard", "deep", "exhaustive"]);

function normalizeCommand(rawCommand: string): string {
  let command = rawCommand.trim();
  command = command.replace(/^\/find\b/i, "find");
  command = command.replace(/^search\b/i, "find");
  return command.trim();
}

function extractIsoDateRange(command: string): { from?: string; to?: string } {
  const fromTo = command.match(
    /from\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/i,
  );
  if (fromTo) {
    return { from: fromTo[1], to: fromTo[2] };
  }

  const between = command.match(
    /between\s+(\d{4}-\d{2}-\d{2})\s+and\s+(\d{4}-\d{2}-\d{2})/i,
  );
  if (between) {
    return { from: between[1], to: between[2] };
  }

  if (/\bupcoming\b/i.test(command)) {
    const today = new Date();
    const from = today.toISOString().slice(0, 10);
    const future = new Date(today);
    future.setMonth(future.getMonth() + 6);
    return { from, to: future.toISOString().slice(0, 10) };
  }

  if (/\bin\s+the\s+next\s+2\s+months?\b|\bnext\s+2\s+months?\b/i.test(command)) {
    const today = new Date();
    const future = new Date(today);
    future.setMonth(future.getMonth() + 2);
    return { from: today.toISOString().slice(0, 10), to: future.toISOString().slice(0, 10) };
  }

  if (/\bin\s+the\s+next\s+month\b|\bnext\s+month\b/i.test(command)) {
    const today = new Date();
    const future = new Date(today);
    future.setMonth(future.getMonth() + 1);
    return { from: today.toISOString().slice(0, 10), to: future.toISOString().slice(0, 10) };
  }

  return {};
}

function extractLocations(command: string): string[] {
  const found = new Set<string>();
  const lower = command.toLowerCase();

  for (const [alias, canonical] of Object.entries(LOCATION_ALIASES)) {
    const pattern = new RegExp(`\\b${alias.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (pattern.test(lower)) {
      found.add(canonical);
    }
  }

  if (/\bnear\s+waterloo\b/i.test(command)) {
    found.add("Waterloo");
  }

  return [...found];
}

function extractThemes(command: string): string[] {
  const found = new Set<string>();
  const lower = command.toLowerCase();

  for (const [alias, canonical] of Object.entries(THEME_ALIASES)) {
    const pattern = new RegExp(`\\b${alias.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (pattern.test(lower)) {
      found.add(canonical);
    }
  }

  return [...found];
}

function extractSources(command: string): SourceName[] {
  const found = new Set<SourceName>();
  const lower = command.toLowerCase();

  for (const [alias, source] of Object.entries(SOURCE_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`, "i").test(lower)) {
      found.add(source);
    }
  }

  return [...found];
}

function extractModes(command: string): DiscoveryMode[] {
  const modes = new Set<DiscoveryMode>();
  const lower = command.toLowerCase();

  if (/\b(remote|online)\b/i.test(lower)) {
    modes.add("online");
  }
  if (/\b(in[- ]?person|on[- ]?site)\b/i.test(lower)) {
    modes.add("in-person");
  }
  if (/\bhybrid\b/i.test(lower)) {
    modes.add("hybrid");
  }

  return [...modes];
}

function extractReviewPolicy(command: string): ReviewPolicy {
  const flag = command.match(/--review-policy=(broad|balanced|strict)\b/i);
  if (flag && REVIEW_POLICIES.has(flag[1]!.toLowerCase() as ReviewPolicy)) {
    return flag[1]!.toLowerCase() as ReviewPolicy;
  }
  if (/\bbroad review\b|\bhigh recall\b|\bprefer false positives\b/i.test(command)) {
    return "broad";
  }
  if (/\bstrict review\b|\bstrict mode\b/i.test(command)) return "strict";
  if (/\bbalanced review\b|\bbalanced mode\b/i.test(command)) return "balanced";
  return "broad";
}

function extractProfile(command: string): DiscoveryProfile | undefined {
  const flag = command.match(/--profile(?:=|\s+)(light|standard|deep|exhaustive)\b/i);
  const profile = flag?.[1]?.toLowerCase() as DiscoveryProfile | undefined;
  return profile && PROFILES.has(profile) ? profile : undefined;
}

function locationConstraintFor(
  command: string,
  locations: string[],
): DiscoveryPreferences["locationConstraint"] {
  if (
    /\b(?:people|participants?|students?|builders?)\s+in\s+[^.]+?\b(?:eligible|can participate|open to)|\beligible\s+for\b|\bopen to\s+(?:canadians|people in canada|canada)\b/i.test(command)
  ) {
    return "participant_eligibility";
  }
  if (
    locations.length > 0 &&
    /\b(?:in|near|around|at)\s+(toronto|gta|greater toronto|waterloo|mississauga|canada)\b/i.test(command)
  ) {
    return "event_location";
  }
  return "none";
}

function remotePolicyFor(
  command: string,
  locationConstraint: DiscoveryPreferences["locationConstraint"],
): RemotePolicy {
  if (/\b(?:remote only|online only)\b/i.test(command) || /--remote\b/i.test(command)) {
    return "only";
  }
  if (/--onsite-only\b/i.test(command) || /\b(?:in[- ]?person|onsite|on[- ]?site)\b/i.test(command)) {
    return "exclude";
  }
  if (/--include-remote\b/i.test(command) || /\bor remote\b|\bremote or\b|\bremote\/online\b/i.test(command)) {
    return "include";
  }
  if (locationConstraint === "participant_eligibility") return "inferred_open";
  if (locationConstraint === "event_location") return "exclude";
  if (/\b(remote|online|virtual)\b/i.test(command)) return "only";
  return "include";
}

export function getDefaultDiscoveryPreferences(rawCommand: string): DiscoveryPreferences {
  return {
    rawCommand,
    locations: [],
    locationConstraint: "none",
    remotePolicy: "include",
    themes: [...DEFAULT_THEMES],
    modes: ["online", "in-person", "hybrid"],
    sources: [...REAL_DEFAULT_SOURCES],
    includeRemote: true,
    includeInPerson: true,
    maxResults: 100,
    reviewPolicy: "broad",
  };
}

export function applyCliOptions(
  preferences: DiscoveryPreferences,
  options: {
    sources?: SourceName[];
    maxResults?: number;
    reviewPolicy?: ReviewPolicy;
    profile?: DiscoveryProfile;
    remotePolicy?: RemotePolicy;
    onsiteOnly?: boolean;
  },
): DiscoveryPreferences {
  const remotePolicy = options.remotePolicy ?? preferences.remotePolicy;
  return {
    ...preferences,
    sources: options.sources && options.sources.length > 0 ? options.sources : preferences.sources,
    maxResults: options.maxResults ?? preferences.maxResults,
    reviewPolicy: options.reviewPolicy ?? preferences.reviewPolicy,
    profile: options.profile ?? preferences.profile,
    remotePolicy,
    onsiteOnly: options.onsiteOnly ?? preferences.onsiteOnly,
    includeRemote:
      remotePolicy === "include" ||
      remotePolicy === "only" ||
      remotePolicy === "inferred_open",
    includeInPerson: remotePolicy !== "only",
  };
}

export function parseCommand(rawCommand: string): DiscoveryPreferences {
  const normalized = normalizeCommand(rawCommand);
  const defaults = getDefaultDiscoveryPreferences(normalized);

  const locations = extractLocations(normalized);
  const themes = extractThemes(normalized);
  const sources = extractSources(normalized);
  const modes = extractModes(normalized);
  const dateRange = extractIsoDateRange(normalized);
  const reviewPolicy = extractReviewPolicy(normalized);
  const profile = extractProfile(normalized);
  const locationConstraint = locationConstraintFor(normalized, locations);
  const remotePolicy = remotePolicyFor(normalized, locationConstraint);
  const onsiteOnly = /--onsite-only\b/i.test(normalized);

  const includeRemote =
    remotePolicy === "include" ||
    remotePolicy === "only" ||
    remotePolicy === "inferred_open";
  const includeInPerson = remotePolicy !== "only";

  return {
    rawCommand: normalized,
    locations: locations.length > 0 ? locations : defaults.locations,
    locationConstraint,
    remotePolicy,
    onsiteOnly,
    profile,
    themes: themes.length > 0 ? themes : defaults.themes,
    modes: modes.length > 0 ? modes : defaults.modes,
    sources: sources.length > 0 ? sources : defaults.sources,
    includeRemote,
    includeInPerson,
    maxResults: defaults.maxResults,
    reviewPolicy,
    dateFrom: dateRange.from,
    dateTo: dateRange.to,
  };
}
