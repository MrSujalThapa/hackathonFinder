import type { FieldMapping } from "@/experiments/scraper-v2/types";

const FIELD_PATTERNS: Record<keyof FieldMapping, RegExp[]> = {
  title: [/\b(title|name|hackathonName|eventName)\b/i],
  url: [/\b(url|href|link|website|site|publicUrl|externalUrl)\b/i],
  slug: [/\b(slug|handle|subdomain)\b/i],
  id: [/\b(id|uuid|uid|hackathonId|eventId)\b/i],
  startDate: [/\b(start|startsAt|startDate|startTime|begin|beginsAt)\b/i],
  endDate: [/\b(end|endsAt|endDate|endTime|finish|finishesAt)\b/i],
  registrationDeadline: [/\b(deadline|registrationDeadline|endsOn|applyBy|submissionDeadline)\b/i],
  location: [/\b(location|venue|city|country|region|address)\b/i],
  mode: [/\b(mode|type|format|isOnline|online|virtual)\b/i],
  description: [/\b(description|summary|subtitle|tagline|about)\b/i],
  status: [/\b(status|state|phase|applicationStatus|hackathonStatus)\b/i],
};

function flattenKeys(record: Record<string, unknown>, prefix = "", depth = 0): string[] {
  if (depth > 2) return [];
  const keys: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    keys.push(path);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Record<string, unknown>, path, depth + 1));
    }
  }
  return keys;
}

export function valueAtPath(record: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  let current = record;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function inferFieldMappings(records: Array<Record<string, unknown>>): FieldMapping {
  const allKeys = new Set<string>();
  for (const record of records.slice(0, 20)) {
    for (const key of flattenKeys(record)) allKeys.add(key);
  }

  const mapping: FieldMapping = {};
  for (const key of allKeys) {
    for (const [field, patterns] of Object.entries(FIELD_PATTERNS) as Array<
      [keyof FieldMapping, RegExp[]]
    >) {
      if (mapping[field]) continue;
      if (patterns.some((pattern) => pattern.test(key))) {
        mapping[field] = key;
      }
    }
  }
  return mapping;
}
