import type {
  DiscoveryPreferences,
  HackathonEvent,
} from "@/core/discovery/types";
import { normalizeDatePart } from "@/core/dedupe";

export type MissingFactKind =
  | "officialUrl"
  | "applyUrl"
  | "deadline"
  | "startDate"
  | "location"
  | "mode"
  | "eligibility"
  | "prize"
  | "themes";

export type MissingFact = {
  kind: MissingFactKind;
  priority: "high" | "medium" | "low";
  required: boolean;
  question: string;
  searchQueries: string[];
};

function hasIsoDate(value?: string): boolean {
  const normalized = normalizeDatePart(value);
  return Boolean(normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized));
}

function baseQuery(event: HackathonEvent): string {
  return [event.name, event.city ?? event.location, event.country]
    .filter(Boolean)
    .join(" ");
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))];
}

function querySet(event: HackathonEvent, suffixes: string[]): string[] {
  const base = baseQuery(event);
  return unique(suffixes.map((suffix) => `${base} ${suffix}`));
}

export function findMissingFacts(
  event: HackathonEvent,
  preferences?: Pick<DiscoveryPreferences, "themes" | "locations" | "includeRemote">,
): MissingFact[] {
  const missing: MissingFact[] = [];
  const needsLocation =
    event.mode !== "online" &&
    event.city !== "Remote" &&
    !preferences?.includeRemote;

  if (!event.officialUrl) {
    missing.push({
      kind: "officialUrl",
      priority: "high",
      required: true,
      question: "What is the official event page?",
      searchQueries: querySet(event, ["official hackathon", "event page"]),
    });
  }

  if (!event.applyUrl) {
    missing.push({
      kind: "applyUrl",
      priority: "high",
      required: true,
      question: "Where can applicants register or apply?",
      searchQueries: querySet(event, ["apply register deadline", "registration"]),
    });
  }

  if (!hasIsoDate(event.deadline) && !hasIsoDate(event.startDate)) {
    missing.push({
      kind: "deadline",
      priority: "high",
      required: true,
      question: "What is the application deadline or event date?",
      searchQueries: querySet(event, ["deadline", "dates"]),
    });
  } else if (!hasIsoDate(event.deadline)) {
    missing.push({
      kind: "deadline",
      priority: "medium",
      required: false,
      question: "What is the application deadline?",
      searchQueries: querySet(event, ["application deadline", "registration closes"]),
    });
  }

  if (!event.location && !event.city && needsLocation) {
    missing.push({
      kind: "location",
      priority: "medium",
      required: true,
      question: "Where is the event hosted?",
      searchQueries: querySet(event, ["location venue", "where"]),
    });
  }

  if (!event.mode || event.mode === "unknown") {
    missing.push({
      kind: "mode",
      priority: "medium",
      required: false,
      question: "Is the event online, in-person, or hybrid?",
      searchQueries: querySet(event, ["online in-person hybrid"]),
    });
  }

  if (!event.eligibility) {
    missing.push({
      kind: "eligibility",
      priority: "low",
      required: false,
      question: "Who is eligible to participate?",
      searchQueries: querySet(event, ["eligibility students participants"]),
    });
  }

  if (!event.prize) {
    missing.push({
      kind: "prize",
      priority: "low",
      required: false,
      question: "Are prizes or sponsors listed?",
      searchQueries: querySet(event, ["prizes sponsors"]),
    });
  }

  if (event.themes.length === 0 && (preferences?.themes.length ?? 0) > 0) {
    missing.push({
      kind: "themes",
      priority: "low",
      required: false,
      question: "What themes or tracks does the hackathon focus on?",
      searchQueries: querySet(event, [...(preferences?.themes ?? []), "tracks themes"]),
    });
  }

  return missing.sort((left, right) => {
    const score = { high: 0, medium: 1, low: 2 };
    return score[left.priority] - score[right.priority];
  });
}
