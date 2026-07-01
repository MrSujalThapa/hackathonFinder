import type {
  DiscoveryPreferences,
  HackathonEvent,
  ScoringResult,
} from "@/core/discovery/types";
import { normalizeDatePart, normalizeText } from "@/core/dedupe";

const THEME_BONUS_CAP = 30;
const THEME_BONUS_EACH = 10;
const MIN_ACCEPT_SCORE = 55;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isClearlyPast(event: HackathonEvent): boolean {
  const dates = [event.endDate, event.deadline, event.startDate]
    .map((value) => normalizeDatePart(value))
    .filter(Boolean) as string[];

  if (dates.length === 0) {
    return false;
  }

  const latest = dates.sort().at(-1)!;
  return latest < todayIso();
}

function hasUsefulUrl(event: HackathonEvent): boolean {
  return Boolean(event.officialUrl || event.applyUrl || event.socialUrl);
}

function locationText(event: HackathonEvent): string {
  return normalizeText(
    [event.location, event.city, event.country, event.mode].filter(Boolean).join(" "),
  );
}

function matchesPreferredLocation(
  event: HackathonEvent,
  preferences: DiscoveryPreferences,
): boolean {
  const haystack = locationText(event);
  const preferred = preferences.locations.map((value) => normalizeText(value));

  return preferred.some((needle) => haystack.includes(needle));
}

function isRemoteEvent(event: HackathonEvent): boolean {
  const haystack = locationText(event);
  return (
    event.mode === "online" ||
    haystack.includes("remote") ||
    haystack.includes("online")
  );
}

function countThemeMatches(event: HackathonEvent, preferences: DiscoveryPreferences): number {
  const eventThemes = event.themes.map((theme) => normalizeText(theme));
  const preferredThemes = preferences.themes.map((theme) => normalizeText(theme));

  return preferredThemes.filter((theme) =>
    eventThemes.some(
      (eventTheme) => eventTheme.includes(theme) || theme.includes(eventTheme),
    ),
  ).length;
}

export function scoreHackathonEvent(
  event: HackathonEvent,
  preferences: DiscoveryPreferences,
): ScoringResult {
  let score = 0;
  const whyMatch: string[] = [];
  const redFlags: string[] = [];

  if (matchesPreferredLocation(event, preferences)) {
    score += 30;
    whyMatch.push("Matches preferred location");
  }

  if (isRemoteEvent(event) && preferences.includeRemote) {
    score += 25;
    whyMatch.push("Remote/online event");
  }

  const themeMatches = countThemeMatches(event, preferences);
  if (themeMatches > 0) {
    const themeBonus = Math.min(themeMatches * THEME_BONUS_EACH, THEME_BONUS_CAP);
    score += themeBonus;
    whyMatch.push(`Matches ${themeMatches} preferred theme(s)`);
  }

  if (event.applyUrl) {
    score += 10;
    whyMatch.push("Has apply URL");
  }

  if (event.officialUrl) {
    score += 10;
    whyMatch.push("Has official URL");
  }

  if (event.prize) {
    score += 10;
    whyMatch.push("Prize or sponsor listed");
  }

  if (event.eligibility && /student/i.test(event.eligibility)) {
    score += 10;
    whyMatch.push("Student-friendly eligibility");
  }

  if (isClearlyPast(event)) {
    score -= 50;
    redFlags.push("Event clearly ended");
  }

  if (!hasUsefulUrl(event)) {
    score -= 40;
    redFlags.push("No official, apply, or social URL");
  }

  if (!event.deadline && !event.startDate) {
    score -= 25;
    redFlags.push("Date or deadline unclear");
  }

  if (
    !isRemoteEvent(event) &&
    !matchesPreferredLocation(event, preferences) &&
    preferences.includeInPerson
  ) {
    score -= 20;
    redFlags.push("Location not in preferred regions");
  }

  let rejected = false;
  let rejectionReason: string | undefined;

  if (isClearlyPast(event)) {
    rejected = true;
    rejectionReason = "Event already ended";
  } else if (!hasUsefulUrl(event)) {
    rejected = true;
    rejectionReason = "No useful URL exists";
  } else if (score < MIN_ACCEPT_SCORE) {
    rejected = true;
    rejectionReason = `Score below minimum (${score} < ${MIN_ACCEPT_SCORE})`;
  }

  return {
    score,
    whyMatch,
    redFlags,
    rejected,
    rejectionReason,
  };
}
