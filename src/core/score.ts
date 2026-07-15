import type {
  DiscoveryPreferences,
  HackathonEvent,
  ScoringResult,
} from "@/core/discovery/types";
import { normalizeText, sourceAuthority } from "@/core/dedupe";
import {
  applicationDeadlineFor,
  deriveEventTemporalStatus,
  eventEndFor,
  eventStartFor,
  isDeadlineClosed,
  isStaleTitleYear,
  timezoneForLocation,
} from "@/core/dates";
import {
  classifyExplicitCityLocation,
  hasExplicitCityConstraint,
} from "@/core/locationConstraints";

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
    [
      event.location,
      event.city,
      event.region,
      event.country,
      event.mode,
      event.eventLocation?.rawText,
      event.eventLocation?.mode,
    ].filter(Boolean).join(" "),
  );
}

function matchesPreferredLocation(
  event: HackathonEvent,
  preferences: DiscoveryPreferences,
): boolean {
  if (preferences.locations.length === 0) return true;
  const haystack = locationText(event);
  const preferred = preferences.locations.map((value) => normalizeText(value));

  return preferred.some((needle) => {
    if (!needle) return false;
    if (needle === "canada") {
      return haystack.includes("canada");
    }
    return haystack.includes(needle);
  });
}

function isRemoteEvent(event: HackathonEvent): boolean {
  const haystack = locationText(event);
  return (
    event.mode === "online" ||
    event.eventLocation?.mode === "remote" ||
    haystack.includes("remote") ||
    haystack.includes("online") ||
    haystack.includes("everywhere") ||
    haystack.includes("worldwide")
  );
}

function isInPersonEvent(event: HackathonEvent): boolean {
  return event.mode === "in-person" || event.eventLocation?.mode === "in_person";
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

function eventIntentText(event: HackathonEvent): string {
  return normalizeText(
    [
      event.name,
      event.description,
      event.themes.join(" "),
      event.evidence.map((item) => `${item.title ?? ""} ${item.snippet ?? ""}`).join(" "),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function hasHackathonIntent(event: HackathonEvent): boolean {
  const text = eventIntentText(event);
  if (
    /\b(?:hackathon|hack day|hack night|buildathon|codeathon|datathon|ideathon|capture the flag|ctf|builders? sprint|build week)\b/.test(
      text,
    )
  ) {
    return true;
  }

  if (/\b(?:challenge|competition|contest)\b/.test(text)) {
    return /\b(?:build|code|project|prototype|developer|engineering|ai|ml|agent|software|app|startup|cyber)\b/.test(
      text,
    );
  }

  return false;
}

function isObviousNonHackathon(event: HackathonEvent): boolean {
  const title = normalizeText(event.name);
  if (/^(?:facebook|instagram|linkedin|x|twitter|reddit|\d{4}[\s-]\d{2}[\s-]\d{2})$/.test(title)) {
    return true;
  }
  if (/\btop\s+\d+\s+hackers?\b/.test(title)) {
    return true;
  }
  if (/\b(?:dance party|rooftop party|mahjong|matcha|journal|journaling|fitness|yoga|walk|cafe|coffee chat)\b/.test(title)) {
    return true;
  }
  if (/\b(?:conference|meetup|workshop|webinar|talk|panel|demo day|build night)\b/.test(title)) {
    return !/\b(?:hackathon|buildathon|codeathon|datathon|challenge|competition|contest)\b/.test(title);
  }
  return false;
}

function satisfiesTheme(event: HackathonEvent, preferences: DiscoveryPreferences): boolean {
  if (preferences.themes.length === 0) return true;
  return countThemeMatches(event, preferences) > 0;
}

function requestedDateRangeResult(
  event: HackathonEvent,
  preferences: DiscoveryPreferences,
): { eligible: boolean; needsReview: boolean; reason?: string } {
  if (!preferences.dateFrom && !preferences.dateTo) {
    return { eligible: true, needsReview: false };
  }

  const start = eventStartFor(event);
  const end = eventEndFor(event) ?? start;
  if (!start || !end) {
    return {
      eligible: true,
      needsReview: true,
      reason: "Event date unknown after enrichment",
    };
  }

  const requestedStart = preferences.dateFrom ?? "0000-01-01";
  const requestedEnd = preferences.dateTo ?? "9999-12-31";
  const overlaps = start <= requestedEnd && end >= requestedStart;
  return overlaps
    ? { eligible: true, needsReview: false }
    : {
        eligible: false,
        needsReview: false,
        reason: "Event date falls outside the requested range",
      };
}

function eligibilityText(event: HackathonEvent): string {
  return normalizeText(
    [event.eligibility, event.description, event.location, event.country]
      .filter(Boolean)
      .join(" "),
  );
}

function participantEligibilityMatches(
  event: HackathonEvent,
  preferences: DiscoveryPreferences,
): { eligible: boolean; needsReview: boolean; reason?: string } {
  if ((preferences.locationConstraint ?? "none") !== "participant_eligibility") {
    return { eligible: true, needsReview: false };
  }

  const wantsCanada =
    preferences.locations.some((location) => normalizeText(location) === "canada") ||
    /\bcanada|canadian/i.test(preferences.rawCommand);
  if (!wantsCanada) {
    return { eligible: true, needsReview: true, reason: "Participant eligibility unclear" };
  }

  const text = eligibilityText(event);
  if (/\b(canada|canadian|global|worldwide|anywhere|open to all)\b/.test(text)) {
    return { eligible: true, needsReview: false };
  }
  if (isRemoteEvent(event)) {
    return { eligible: true, needsReview: true, reason: "Remote eligibility for Canada unclear" };
  }
  if (event.country === "Canada" || /\bcanada\b/.test(locationText(event))) {
    return { eligible: true, needsReview: false };
  }
  return {
    eligible: false,
    needsReview: false,
    reason: "Participant eligibility does not include Canada",
  };
}

function reject(reason: string): EligibilityResult {
  return {
    eligible: false,
    needsReview: false,
    reasons: [reason],
    rejectionReason: reason,
  };
}

/**
 * Hard eligibility gates, evaluated before preference ranking.
 */
export function evaluateEligibility(
  event: HackathonEvent,
  preferences: DiscoveryPreferences,
  options: ScoreOptions = {},
): EligibilityResult {
  const now = options.now ?? new Date();
  const reasons: string[] = [];
  const broad = preferences.reviewPolicy !== "strict";

  const applicationDeadline = applicationDeadlineFor(event);
  if (isDeadlineClosed(applicationDeadline, now)) {
    return reject("Registration/application deadline has passed");
  }

  const temporalStatus = deriveEventTemporalStatus({
    startDate: eventStartFor(event),
    endDate: eventEndFor(event),
    timezone: timezoneForLocation(event),
    now,
  });

  if (temporalStatus === "FINISHED") {
    return reject("Event already ended");
  }
  if (temporalStatus === "UNKNOWN") {
    reasons.push("Event date unclear");
  }

  if (isStaleTitleYear(event.name, event, now)) {
    return reject("Title year is in the past without a verified current edition");
  }

  if (!hasUsefulUrl(event)) {
    if (broad) {
      return {
        eligible: true,
        needsReview: true,
        reasons: ["No official/apply URL"],
      };
    }
    return reject("No useful official or apply URL");
  }

  if (isObviousNonHackathon(event) || !hasHackathonIntent(event)) {
    return reject("Candidate is not a hackathon or hackathon-like competition");
  }

  if (!satisfiesTheme(event, preferences)) {
    return reject("Theme does not match requested topics");
  }

  const participantEligibility = participantEligibilityMatches(event, preferences);
  if (!participantEligibility.eligible) {
    return reject(participantEligibility.reason ?? "Participant eligibility mismatch");
  }
  if (participantEligibility.needsReview && participantEligibility.reason) {
    reasons.push(participantEligibility.reason);
  }

  if (preferences.onsiteOnly && !isInPersonEvent(event)) {
    return reject("Onsite-only query requires a physical event");
  }

  const explicitLocation = classifyExplicitCityLocation(event, preferences);
  const locationConstraint = preferences.locationConstraint ?? "none";
  const remotePolicy = preferences.remotePolicy ?? (preferences.includeRemote ? "include" : "exclude");
  if (locationConstraint === "event_location") {
    const remoteOk = isRemoteEvent(event) && remotePolicy === "include";
    if (isRemoteEvent(event) && remotePolicy === "exclude") {
      return reject("Remote-only event was not requested for this city query");
    }
    if (hasExplicitCityConstraint(preferences)) {
      if (!explicitLocation.eligible && !remoteOk) {
        return reject(explicitLocation.reason);
      }
      if (explicitLocation.needsReview && !remoteOk) {
        reasons.push(explicitLocation.reason);
      }
    } else {
      const locationOk = matchesPreferredLocation(event, preferences);
      if (!remoteOk && !locationOk) {
        if (!event.location && !event.city && !event.country) {
          reasons.push("Location unclear for requested event-location query");
        } else {
          return reject("Location does not match requested regions and event is not remote");
        }
      }
    }
  } else if (remotePolicy === "only" && !isRemoteEvent(event)) {
    return reject("Remote-only query requires remote participation");
  } else if (locationConstraint === "none" && remotePolicy === "exclude" && isRemoteEvent(event)) {
    return reject("Remote events excluded by onsite-only policy");
  } else if (locationConstraint !== "participant_eligibility") {
    const remoteOk = isRemoteEvent(event) && preferences.includeRemote;
    const locationOk = matchesPreferredLocation(event, preferences);
    if (!remoteOk && !locationOk) {
      if (broad) {
        return {
          eligible: true,
          needsReview: true,
          reasons: [...reasons, "Outside requested geography"],
        };
      }
      return reject("Location does not match requested regions and event is not remote");
    }
  }

  const dateRange = requestedDateRangeResult(event, preferences);
  if (!dateRange.eligible) {
    return reject(dateRange.reason ?? "Event date falls outside the requested range");
  }
  if (dateRange.needsReview && dateRange.reason) {
    reasons.push(dateRange.reason);
  }

  reasons.push("Passed hard eligibility");
  return {
    eligible: true,
    needsReview: reasons.some((reason) => /unclear|unknown|review/i.test(reason)),
    reasons,
  };
}

function rankPreferences(
  event: HackathonEvent,
  preferences: DiscoveryPreferences,
): { score: number; whyMatch: string[]; redFlags: string[] } {
  let score = 40;
  const whyMatch: string[] = ["Eligible individual event"];
  const redFlags: string[] = [];

  if (preferences.locations.length > 0 && matchesPreferredLocation(event, preferences)) {
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

  if (!applicationDeadlineFor(event)) {
    redFlags.push("Applications close: Unknown");
  }
  if (!eventStartFor(event)) {
    score -= 10;
    redFlags.push("Event date unclear");
  }

  if (/toronto|waterloo/i.test(locationText(event))) {
    score += 5;
    whyMatch.push("Toronto/Waterloo proximity");
  }

  return { score, whyMatch, redFlags };
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
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
    score: clampScore(ranked.score),
    whyMatch: ranked.whyMatch,
    redFlags: ranked.redFlags,
    rejected: false,
  };
}
