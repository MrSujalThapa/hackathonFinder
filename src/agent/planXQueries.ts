import type { DiscoveryPreferences } from "@/core/discovery/types";

const DEFAULT_MAX_QUERIES = 6;
const MAX_THEMES = 2;

/** Trusted public organizer accounts — at most 1–2 `from:` queries. */
const TRUSTED_ORGANIZERS = ["MLHacks", "Devpost"] as const;

function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}

function dedupeQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of queries) {
    const query = normalizeQuery(raw);
    if (!query) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(query);
  }
  return result;
}

function physicalLocations(preferences: DiscoveryPreferences): string[] {
  return preferences.locations.filter((loc) => !/^(remote|online)$/i.test(loc));
}

function resolveYear(preferences: DiscoveryPreferences): string {
  return (
    preferences.dateFrom?.slice(0, 4) ??
    preferences.dateTo?.slice(0, 4) ??
    String(new Date().getUTCFullYear())
  );
}

/**
 * Deterministic X (Twitter) public-post query planner (no LLM).
 * Produces a small, deduplicated set of X-native search strings.
 */
export function planXQueries(
  preferences: DiscoveryPreferences,
  options?: { maxQueries?: number },
): string[] {
  const max = options?.maxQueries ?? DEFAULT_MAX_QUERIES;
  if (max <= 0) return [];

  const locations = physicalLocations(preferences);
  const themes = preferences.themes.slice(0, MAX_THEMES);
  const primaryLocation = locations[0] ?? "Canada";
  const countryHint = locations.find((loc) => /^canada$/i.test(loc)) ?? "Canada";
  const year = resolveYear(preferences);
  const primaryTheme = themes[0];

  const queries: string[] = [];

  // Location + event type; -is:retweet keeps results closer to original posts
  queries.push(`hackathon ${primaryLocation} -is:retweet`);

  // Apply / registration intent (quoted phrase for precision)
  queries.push(`"applications open" hackathon ${countryHint}`);

  // Theme × location (or theme × remote when remote is preferred)
  if (primaryTheme) {
    if (preferences.includeRemote) {
      queries.push(`${primaryTheme} hackathon remote deadline`);
    } else {
      queries.push(`${primaryTheme} hackathon ${primaryLocation}`);
    }
  } else if (preferences.includeRemote) {
    queries.push("hackathon remote applications open");
  } else {
    queries.push(`hackathon ${primaryLocation} deadline ${year}`);
  }

  // Alternate event names without exploding synonyms
  queries.push(`buildathon OR codefest ${countryHint}`);

  // Trusted organizers (at most two `from:` queries)
  queries.push(`from:${TRUSTED_ORGANIZERS[0]} hackathon`);
  if (preferences.includeRemote || themes.length > 0) {
    queries.push(`from:${TRUSTED_ORGANIZERS[1]} "applications open"`);
  }

  // Second location if distinct and room remains after slice
  if (locations[1] && locations[1].toLowerCase() !== primaryLocation.toLowerCase()) {
    queries.push(`hackathon ${locations[1]} "registration open"`);
  }

  // Second theme without duplicating the first theme query
  if (themes[1] && themes[1].toLowerCase() !== (primaryTheme ?? "").toLowerCase()) {
    queries.push(`${themes[1]} hackathon ${primaryLocation} lang:en`);
  }

  // Generic Canada apply signal as a late fill when earlier slots are sparse
  queries.push(`hackathon Canada "apply now" ${year}`);

  return dedupeQueries(queries).slice(0, max);
}

export function formatXPlan(queries: string[]): string {
  if (queries.length === 0) return "(no X queries planned)";
  return queries.map((query, index) => `${index + 1}. ${query}`).join("\n");
}
