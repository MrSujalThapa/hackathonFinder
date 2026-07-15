import type {
  DiscoveryMode,
  DiscoverySourceId,
  HackathonEvent,
  HackathonEvidence,
} from "@/core/discovery/types";
import {
  createCandidateFingerprint,
  createSoftEventKey,
  preferMode,
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

function asIdList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  const single = String(value).trim();
  return single ? [single] : [];
}

/**
 * Merge source_ids maps. Same-source IDs accumulate as a string or string[]
 * (e.g. multiple X post IDs → { x: ["123", "456"] }).
 */
export function mergeSourceIds(
  left?: Record<string, unknown>,
  right?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!left && !right) return undefined;

  const merged: Record<string, unknown> = { ...(left ?? {}) };
  for (const [key, value] of Object.entries(right ?? {})) {
    if (value === null || value === undefined) continue;
    const existing = merged[key];
    if (existing === null || existing === undefined) {
      merged[key] = Array.isArray(value)
        ? [...new Set(asIdList(value))].length === 1
          ? asIdList(value)[0]!
          : [...new Set(asIdList(value))]
        : value;
      continue;
    }

    const combined = [...new Set([...asIdList(existing), ...asIdList(value)])];
    merged[key] = combined.length === 1 ? combined[0]! : combined;
  }
  return merged;
}

function pickPrimarySource(
  existing: DiscoverySourceId,
  incoming: DiscoverySourceId,
): DiscoverySourceId {
  return sourceAuthority(incoming) > sourceAuthority(existing) ? incoming : existing;
}

export function mergeHackathonEventPair(
  existing: HackathonEvent,
  incoming: HackathonEvent,
): HackathonEvent {
  const primarySource = pickPrimarySource(existing.source, incoming.source);
  const left = existing.source;
  const right = incoming.source;

  return {
    name: preferStrongerText(existing.name, incoming.name, left, right) ?? existing.name,
    source: primarySource,
    officialUrl: preferUrl(
      existing.officialUrl,
      incoming.officialUrl,
      left,
      right,
    ),
    applyUrl: preferUrl(
      existing.applyUrl,
      incoming.applyUrl,
      left,
      right,
    ),
    socialUrl: preferUrl(existing.socialUrl, incoming.socialUrl, left, right),
    eventStartDate: preferStrongerText(existing.eventStartDate, incoming.eventStartDate, left, right),
    eventEndDate: preferStrongerText(existing.eventEndDate, incoming.eventEndDate, left, right),
    registrationOpenDate: preferStrongerText(existing.registrationOpenDate, incoming.registrationOpenDate, left, right),
    registrationDeadline: preferStrongerText(existing.registrationDeadline, incoming.registrationDeadline, left, right),
    applicationDeadline: preferStrongerText(existing.applicationDeadline, incoming.applicationDeadline, left, right),
    submissionDeadline: preferStrongerText(existing.submissionDeadline, incoming.submissionDeadline, left, right),
    resultAnnouncementDate: preferStrongerText(existing.resultAnnouncementDate, incoming.resultAnnouncementDate, left, right),
    parsedDateEvidence: [
      ...new Map(
        [...(existing.parsedDateEvidence ?? []), ...(incoming.parsedDateEvidence ?? [])].map((item) => [
          `${item.kind}:${item.value ?? ""}:${item.sourceUrl}:${item.sourceText ?? ""}`,
          item,
        ]),
      ).values(),
    ],
    startDate: preferStrongerText(existing.startDate, incoming.startDate, left, right),
    endDate: preferStrongerText(existing.endDate, incoming.endDate, left, right),
    deadline: preferStrongerText(existing.deadline, incoming.deadline, left, right),
    location: preferStrongerText(existing.location, incoming.location, left, right),
    mode: preferMode(existing.mode, incoming.mode, left, right) as
      | DiscoveryMode
      | undefined,
    eventLocation:
      incoming.eventLocation?.confidence === "high"
        ? incoming.eventLocation
        : existing.eventLocation ?? incoming.eventLocation,
    city: preferStrongerText(existing.city, incoming.city, left, right),
    region: preferStrongerText(existing.region, incoming.region, left, right),
    country: preferStrongerText(existing.country, incoming.country, left, right),
    prize: preferStrongerText(existing.prize, incoming.prize, left, right),
    themes: [...new Set([...(existing.themes ?? []), ...(incoming.themes ?? [])])],
    eligibility: preferStrongerText(
      existing.eligibility,
      incoming.eligibility,
      left,
      right,
    ),
    description: preferStrongerText(
      existing.description,
      incoming.description,
      left,
      right,
    ),
    sourceIds: mergeSourceIds(existing.sourceIds, incoming.sourceIds),
    evidence: mergeEvidence(existing.evidence ?? [], incoming.evidence ?? []),
  };
}

export type CrossSourceMergeResult = {
  events: HackathonEvent[];
  mergeCount: number;
};

/**
 * Collapse cross-source duplicates while keeping yearly editions / cities separate.
 * Authority: official page → MLH/Devpost → Luma → HackList → X → generic web snippet.
 * X attaches evidence/sourceIds and may fill missing fields only.
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
