import type {
  DiscoveryPreferences,
  HackathonEvent,
  ScoringResult,
} from "@/core/discovery/types";
import { normalizeText, sourceAuthority } from "@/core/dedupe";
import {
  isDeadlineClosed,
  isEventEnded,
  isStaleTitleYear,
} from "@/core/dates";

const THEME_BONUS_CAP = 30;
const THEME_BONUS_EACH = 10;

export type ScoreOptions = {
  now?: Date;
};

export type EligibilityResult = {
  eligible: boolean;
  needsReview: boolean;
  reasons: string[];
  rejectionReason?: string;
};

function hasUsefulUrl(event: HackathonEvent): boolean {
  return Boolean(event.officialUrl || event.applyUrl);
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

  return preferred.some((needle) => {
    if (!needle) return false;
    if (needle === "canada") {
      return haystack.includes("canada") || haystack.includes("toronto") || haystack.includes("waterloo") || haystack.includes("mississauga");
    }
    return haystack.includes(needle);
  });
}

function isRemoteEvent(event: HackathonEvent): boolean {
  const haystack = locationText(event);
  return (
    event.mode === "online" ||
    haystack.includes("remote") ||
    haystack.includes("online") ||
    haystack.includes("everywhere") ||
    haystack.includes("worldwide")
  );
}

function countThemeMatches(event: HackathonEvent, preferences: DiscoveryPreferences): number {
  const eventThemes = event.themes.map((theme) => normalizeText(theme));
  const preferredThemes = preferences.themes.map((theme) => normalizeText(theme));
  const blob = normalizeText([event.name, event.description].filter(Boolean).join(" "));

  return preferredThemes.filter(
    (theme) =>
      eventThemes.some(
        (eventTheme) => eventTheme.includes(theme) || theme.includes(eventTheme),
      ) || blob.includes(theme),
  ).length;
}

function inRequestedDateRange(
  event: HackathonEvent,
  preferences: DiscoveryPreferences,
): boolean {
  if (!preferences.dateFrom && !preferences.dateTo) return true;

  const eventDay =
    event.startDate ?? event.deadline ?? event.endDate;
  if (!eventDay) return true; // unknown dates do not fail eligibility

  if (preferences.dateFrom && eventDay < preferences.dateFrom) return false;
  if (preferences.dateTo && eventDay > preferences.dateTo) return false;
  return true;
}

/**
 * Hard eligibility gates — separate from preference ranking.
 */
export function evaluateEligibility(
  event: HackathonEvent,
  preferences: DiscoveryPreferences,
  options: ScoreOptions = {},
): EligibilityResult {
  const now = options.now ?? new Date();
  const reasons: string[] = [];
  const broad = preferences.reviewPolicy !== "strict";

  if (isDeadlineClosed(event.deadline, now)) {
    return {
      eligible: false,
      needsReview: false,
      reasons: ["Registration closed"],
      rejectionReason: "Registration deadline has passed",
    };
  }

  if (isEventEnded(event, now)) {
    return {
      eligible: false,
      needsReview: false,
      reasons: ["Event ended"],
      rejectionReason: "Event already ended",
    };
  }

  if (isStaleTitleYear(event.name, event, now)) {
    return {
      eligible: false,
      needsReview: false,
      reasons: ["Stale title year"],
      rejectionReason: "Title year is in the past without a verified current edition",
    };
  }

  if (!hasUsefulUrl(event)) {
    if (broad) {
      return {
        eligible: true,
        needsReview: true,
        reasons: ["No official/apply URL"],
      };
    }
    return {
      eligible: false,
      needsReview: false,
      reasons: ["No official/apply URL"],
      rejectionReason: "No useful official or apply URL",
    };
  }

  const remoteOk = isRemoteEvent(event) && preferences.includeRemote;
  const locationOk = matchesPreferredLocation(event, preferences);
  if (!remoteOk && !locationOk) {
    if (broad) {
      return {
        eligible: true,
        needsReview: true,
        reasons: ["Outside requested geography"],
      };
    }
    return {
      eligible: false,
      needsReview: false,
      reasons: ["Outside requested geography"],
      rejectionReason: "Location does not match requested regions and event is not remote",
    };
  }

  if (!inRequestedDateRange(event, preferences)) {
    if (broad) {
      return {
        eligible: true,
        needsReview: true,
        reasons: ["Outside requested date range"],
      };
    }
    return {
      eligible: false,
      needsReview: false,
      reasons: ["Outside requested date range"],
      rejectionReason: "Event date falls outside the requested range",
    };
  }

  reasons.push("Passed hard eligibility");
  return { eligible: true, needsReview: false, reasons };
}

function rankPreferences(
  event: HackathonEvent,
  preferences: DiscoveryPreferences,
): { score: number; whyMatch: string[]; redFlags: string[] } {
  let score = 40; // eligible baseline so Canada/remote events pass without theme
  const whyMatch: string[] = ["Eligible individual event"];
  const redFlags: string[] = [];

  if (matchesPreferredLocation(event, preferences)) {
    score += 25;
    whyMatch.push("Matches preferred location");
  }

  if (isRemoteEvent(event) && preferences.includeRemote) {
    score += 20;
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
    score += 8;
    whyMatch.push("Prize or sponsor listed");
  }

  if (event.eligibility && /student/i.test(event.eligibility)) {
    score += 8;
    whyMatch.push("Student-friendly eligibility");
  }

  const authority = sourceAuthority(event.source);
  if (authority >= 70) {
    score += 8;
    whyMatch.push("Authoritative source");
  }

  if (!event.deadline && !event.startDate) {
    score -= 10;
    redFlags.push("Date or deadline unclear");
  }

  if (
    /toronto|waterloo/i.test(locationText(event))
  ) {
    score += 5;
    whyMatch.push("Toronto/Waterloo proximity");
  }

  return { score, whyMatch, redFlags };
}

export function scoreHackathonEvent(
  event: HackathonEvent,
  preferences: DiscoveryPreferences,
  options: ScoreOptions = {},
): ScoringResult {
  const eligibility = evaluateEligibility(event, preferences, options);
  if (!eligibility.eligible) {
    return {
      score: 0,
      whyMatch: eligibility.reasons,
      redFlags: eligibility.reasons,
      rejected: true,
      rejectionReason: eligibility.rejectionReason,
    };
  }

  const ranked = rankPreferences(event, preferences);
  if (eligibility.needsReview) {
    ranked.redFlags.push(...eligibility.reasons);
  }
  return {
    score: ranked.score,
    whyMatch: ranked.whyMatch,
    redFlags: ranked.redFlags,
    rejected: false,
  };
}
