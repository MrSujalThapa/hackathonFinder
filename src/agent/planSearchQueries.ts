import type { DiscoveryPreferences } from "@/core/discovery/types";

const MAX_QUERIES = 10;

function monthYearLabel(iso?: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

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

/**
 * Deterministic search-query planner (no LLM).
 * Caps at 6–10 focused queries from DiscoveryPreferences.
 */
export function planSearchQueries(preferences: DiscoveryPreferences): string[] {
  const queries: string[] = [];
  const locations = preferences.locations.filter((loc) => !/^(remote|online)$/i.test(loc));
  const themes = preferences.themes.slice(0, 3);
  const primaryLocation = locations[0] ?? "Canada";
  const monthFrom = monthYearLabel(preferences.dateFrom);
  const year =
    preferences.dateFrom?.slice(0, 4) ??
    preferences.dateTo?.slice(0, 4) ??
    String(new Date().getUTCFullYear());

  // Location + apply intent
  queries.push(`hackathon ${primaryLocation} ${monthFrom ?? year} apply`);

  // Theme-focused
  if (themes[0]) {
    queries.push(`${themes[0]} hackathon Canada registration`);
  } else {
    queries.push("AI hackathon Canada registration");
  }

  if (themes.includes("agents") || themes.includes("AI")) {
    queries.push("agent hackathon remote deadline");
  }

  // Mode / remote
  if (preferences.includeRemote) {
    queries.push("hackathon remote online applications open");
  }

  // Source-specific site constraints
  queries.push(`site:lu.ma hackathon ${locations[0] ?? "Toronto"}`);
  queries.push(`site:mlh.io events ${locations.includes("Canada") ? "Canada" : primaryLocation}`);
  if (locations.includes("Waterloo") || /waterloo/i.test(primaryLocation)) {
    queries.push("site:devpost.com hackathon Waterloo");
  } else {
    queries.push(`site:devpost.com hackathon ${primaryLocation}`);
  }

  // Student / generic fallbacks
  queries.push(`student hackathon ${primaryLocation} ${year}`);
  queries.push("hackathon applications open Canada");

  // Second location if present and room remains
  if (locations[1]) {
    queries.push(`hackathon ${locations[1]} ${year} apply`);
  }

  // Theme × location without exploding (at most one extra)
  if (themes[1] && locations[0]) {
    queries.push(`${themes[1]} hackathon ${locations[0]}`);
  }

  return dedupeQueries(queries).slice(0, MAX_QUERIES);
}

export function formatSearchPlan(queries: string[]): string {
  if (queries.length === 0) return "(no search queries planned)";
  return queries.map((query, index) => `${index + 1}. ${query}`).join("\n");
}
