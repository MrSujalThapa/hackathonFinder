import type { HackathonEvent, HackathonEvidence, SourceName } from "@/core/discovery/types";
import {
  createCandidateFingerprint,
  createSoftEventKey,
  preferStrongerText,
  preferUrl,
  softEventsMatch,
  sourceAuthority,
} from "@/core/dedupe";

function mergeEvidence(
  left: HackathonEvidence[],
  right: HackathonEvidence[],
): HackathonEvidence[] {
  const seen = new Set<string>();
  const merged: HackathonEvidence[] = [];
  for (const item of [...left, ...right]) {
    const key = `${item.type}:${item.url ?? ""}:${item.title ?? ""}:${item.snippet ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function pickPrimarySource(existing: SourceName, incoming: SourceName): SourceName {
  return sourceAuthority(incoming) > sourceAuthority(existing) ? incoming : existing;
}

export function mergeHackathonEventPair(
  existing: HackathonEvent,
  incoming: HackathonEvent,
): HackathonEvent {
  const primarySource = pickPrimarySource(existing.source, incoming.source);

  return {
    name: existing.name || incoming.name,
    source: primarySource,
    officialUrl: preferUrl(
      existing.officialUrl,
      incoming.officialUrl,
      existing.source,
      incoming.source,
    ),
    applyUrl: preferUrl(
      existing.applyUrl,
      incoming.applyUrl,
      existing.source,
      incoming.source,
    ),
    socialUrl: preferUrl(existing.socialUrl, incoming.socialUrl),
    startDate: preferStrongerText(existing.startDate, incoming.startDate),
    endDate: preferStrongerText(existing.endDate, incoming.endDate),
    deadline: preferStrongerText(existing.deadline, incoming.deadline),
    location: preferStrongerText(existing.location, incoming.location),
    mode: existing.mode && existing.mode !== "unknown" ? existing.mode : incoming.mode,
    city: preferStrongerText(existing.city, incoming.city),
    country: preferStrongerText(existing.country, incoming.country),
    prize: preferStrongerText(existing.prize, incoming.prize),
    themes: [...new Set([...(existing.themes ?? []), ...(incoming.themes ?? [])])],
    eligibility: preferStrongerText(existing.eligibility, incoming.eligibility),
    description: preferStrongerText(existing.description, incoming.description),
    sourceIds: {
      ...(existing.sourceIds ?? {}),
      ...(incoming.sourceIds ?? {}),
    },
    evidence: mergeEvidence(existing.evidence ?? [], incoming.evidence ?? []),
  };
}

export type CrossSourceMergeResult = {
  events: HackathonEvent[];
  mergeCount: number;
};

/**
 * Collapse cross-source duplicates while keeping yearly editions / cities separate.
 */
export function mergeCrossSourceEvents(events: HackathonEvent[]): CrossSourceMergeResult {
  const merged: HackathonEvent[] = [];
  let mergeCount = 0;

  for (const event of events) {
    const fingerprint = createCandidateFingerprint(event);
    const softKey = createSoftEventKey(event);

    const index = merged.findIndex((candidate) => {
      if (createCandidateFingerprint(candidate) === fingerprint) return true;
      if (softKey && createSoftEventKey(candidate) === softKey) return true;
      return softEventsMatch(candidate, event);
    });

    if (index === -1) {
      merged.push(event);
      continue;
    }

    merged[index] = mergeHackathonEventPair(merged[index]!, event);
    mergeCount += 1;
  }

  return { events: merged, mergeCount };
}
