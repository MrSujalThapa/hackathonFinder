export type FingerprintInput = {
  name: string;
  officialUrl?: string | null;
  applyUrl?: string | null;
  socialUrl?: string | null;
  city?: string | null;
  country?: string | null;
  mode?: string | null;
  startDate?: string | null;
  deadline?: string | null;
  sourceIds?: Record<string, unknown>;
};

export function normalizeText(value?: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/www\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const TRACKING_QUERY_PREFIXES = ["utm_", "fbclid", "gclid", "mc_", "ref"];

function stripTrackingParams(url: URL): void {
  const keysToDelete: string[] = [];

  url.searchParams.forEach((_, key) => {
    const lowerKey = key.toLowerCase();
    if (
      TRACKING_QUERY_PREFIXES.some(
        (prefix) => lowerKey === prefix || lowerKey.startsWith(prefix),
      ) ||
      lowerKey === "utm"
    ) {
      keysToDelete.push(key);
    }
  });

  keysToDelete.forEach((key) => url.searchParams.delete(key));
}

export function normalizeUrl(value?: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value.trim());
    url.hash = "";
    stripTrackingParams(url);
    url.searchParams.sort();

    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/$/, "") || "";
    const search = url.search;

    return `${url.protocol}//${host}${pathname}${search}`;
  } catch {
    return normalizeText(value);
  }
}

export function normalizeDatePart(value?: string | null): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    return isoMatch[1];
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return normalizeText(trimmed) || null;
}

function sourceIdValues(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeText(String(entry)))
      .filter(Boolean)
      .sort();
  }
  const single = normalizeText(String(value));
  return single ? [single] : [];
}

export function createSourceIdIdentity(
  sourceIds?: Record<string, unknown>,
): string | null {
  if (!sourceIds) return null;

  const parts = Object.entries(sourceIds)
    .map(([key, value]) => {
      const ids = sourceIdValues(value);
      if (ids.length === 0) return null;
      return `${key}:${ids.join(",")}`;
    })
    .filter((part): part is string => Boolean(part))
    .sort((left, right) => left.localeCompare(right));

  if (parts.length === 0) return null;
  return `source-id:${parts.join("|")}`;
}

export function createSourceUrlIdentity(
  source: string,
  sourceUrl?: string | null,
): string | null {
  const normalizedSource = normalizeText(source);
  const normalizedUrl = normalizeUrl(sourceUrl);
  if (!normalizedSource || !normalizedUrl) return null;
  return `source-url:${normalizedSource}:${normalizedUrl}`;
}

export function createCandidateFingerprint(input: FingerprintInput): string {
  const official = normalizeUrl(input.officialUrl);
  if (official) return `official:${official}`;

  const apply = normalizeUrl(input.applyUrl);
  if (apply) return `apply:${apply}`;

  const social = normalizeUrl(input.socialUrl);
  if (social) return `social:${social}`;

  const sourceId = createSourceIdIdentity(input.sourceIds);
  if (sourceId) return sourceId;

  const name = normalizeText(input.name);
  const place = normalizeText(
    [input.city, input.country, input.mode].filter(Boolean).join(" "),
  );
  const date =
    normalizeDatePart(input.startDate) ??
    normalizeDatePart(input.deadline) ??
    "unknown-date";

  return `event:${name}:${place}:${date}`;
}

export function fingerprintsMatch(
  left: FingerprintInput,
  right: FingerprintInput,
): boolean {
  return createCandidateFingerprint(left) === createCandidateFingerprint(right);
}

/** Soft identity for cross-source merges when official URLs differ. */
export function normalizeEventName(name: string): string {
  return normalizeText(name)
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\b(duplicate listing|copy|edition)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createSoftEventKey(input: FingerprintInput): string | null {
  const name = normalizeEventName(input.name);
  const date =
    normalizeDatePart(input.startDate) ?? normalizeDatePart(input.deadline);
  const city = normalizeText(input.city);
  if (!name || !date) return null;
  const year = date.slice(0, 4);
  // Require city OR explicit online mode so different cities stay separate.
  const place =
    city ||
    (normalizeText(input.mode) === "online" || normalizeText(input.mode) === "remote"
      ? "online"
      : "");
  if (!place) return null;
  return `soft:${name}:${place}:${year}`;
}

function normalizedYear(input: FingerprintInput): string | null {
  const date =
    normalizeDatePart(input.startDate) ?? normalizeDatePart(input.deadline);
  return date?.slice(0, 4) ?? null;
}

function normalizedPlaceTokens(input: FingerprintInput): Set<string> {
  const values = [
    input.city,
    input.country,
    input.mode,
    input.city || input.country ? `${input.city ?? ""} ${input.country ?? ""}` : "",
  ];
  const tokens = new Set<string>();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    tokens.add(normalized);
    for (const token of normalized.split(/\s+/)) {
      if (token) tokens.add(token);
    }
  }
  return tokens;
}

function placesCompatible(left: FingerprintInput, right: FingerprintInput): boolean {
  const leftCity = normalizeText(left.city);
  const rightCity = normalizeText(right.city);
  if (leftCity && rightCity && leftCity !== rightCity) return false;

  const leftTokens = normalizedPlaceTokens(left);
  const rightTokens = normalizedPlaceTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return true;
  if (normalizeText(left.mode) === "online" && normalizeText(right.mode) === "online") {
    return true;
  }
  for (const token of leftTokens) {
    if (rightTokens.has(token)) return true;
  }
  return false;
}

function isMergeableExactName(name: string): boolean {
  if (name.length < 8) return false;
  if (/^(hackathon|ai hackathon|ml hackathon|event|events|builders|challenge)$/i.test(name)) {
    return false;
  }
  return true;
}

function partiallySpecifiedEventsMatch(
  left: FingerprintInput,
  right: FingerprintInput,
): boolean {
  const leftName = normalizeEventName(left.name);
  const rightName = normalizeEventName(right.name);
  if (!leftName || leftName !== rightName || !isMergeableExactName(leftName)) return false;

  const leftYear = normalizedYear(left);
  const rightYear = normalizedYear(right);
  if (leftYear && rightYear && leftYear !== rightYear) return false;

  return placesCompatible(left, right);
}

export function softEventsMatch(left: FingerprintInput, right: FingerprintInput): boolean {
  if (fingerprintsMatch(left, right)) return true;
  const leftKey = createSoftEventKey(left);
  const rightKey = createSoftEventKey(right);
  if (leftKey && rightKey && leftKey === rightKey) return true;

  // Web/search result pointing at the same listing/official host+path stem.
  const leftUrl = normalizeUrl(left.officialUrl) ?? normalizeUrl(left.applyUrl);
  const rightUrl = normalizeUrl(right.officialUrl) ?? normalizeUrl(right.applyUrl);
  if (leftUrl && rightUrl && leftUrl === rightUrl) return true;

  if (partiallySpecifiedEventsMatch(left, right)) return true;

  return false;
}

const SOURCE_AUTHORITY: Record<string, number> = {
  mlh: 80,
  devpost: 78,
  luma: 70,
  hacklist: 55,
  hakku: 55,
  web: 40,
  x: 20,
  mock: 10,
};

export function sourceAuthority(source: string): number {
  return SOURCE_AUTHORITY[source] ?? 30;
}

function hostAuthority(url?: string | null): number {
  if (!url) return 0;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (/(mlh\.io|mlh\.com|devpost\.com)$/.test(host) || host.endsWith(".mlh.com")) return 75;
    if (/(lu\.ma|luma\.com)$/.test(host)) return 65;
    if (/(hacklist|hakku)/.test(host)) return 45;
    // Prefer first-party official domains over aggregators/search
    if (!/(google\.|bing\.|facebook\.|twitter\.|x\.com)/.test(host)) return 90;
    return 20;
  } catch {
    return 0;
  }
}

export function preferUrl(
  existing?: string | null,
  incoming?: string | null,
  existingSource?: string,
  incomingSource?: string,
): string | undefined {
  if (!existing) return incoming ?? undefined;
  if (!incoming) return existing;
  const existingScore =
    hostAuthority(existing) + sourceAuthority(existingSource ?? "");
  const incomingScore =
    hostAuthority(incoming) + sourceAuthority(incomingSource ?? "");
  return incomingScore > existingScore ? incoming : existing;
}

/**
 * Prefer ISO-looking dates and non-empty stronger values over weak/empty.
 * When sources are provided, a lower-authority source cannot overwrite a
 * higher-authority value (X cannot replace MLH/Devpost/Luma/web dates, etc.).
 * Missing fields may still be filled from weaker sources.
 */
export function preferStrongerText(
  existing?: string | null,
  incoming?: string | null,
  existingSource?: string,
  incomingSource?: string,
): string | undefined {
  const left = existing?.trim() || undefined;
  const right = incoming?.trim() || undefined;
  if (!left) return right;
  if (!right) return left;

  const leftIso = Boolean(normalizeDatePart(left)?.match(/^\d{4}-\d{2}-\d{2}$/));
  const rightIso = Boolean(normalizeDatePart(right)?.match(/^\d{4}-\d{2}-\d{2}$/));

  // Data-quality upgrade: ISO date beats vague text regardless of source.
  if (rightIso && !leftIso) return normalizeDatePart(right) ?? right;
  if (leftIso && !rightIso) return normalizeDatePart(left) ?? left;

  if (existingSource !== undefined || incomingSource !== undefined) {
    const leftAuth = sourceAuthority(existingSource ?? "");
    const rightAuth = sourceAuthority(incomingSource ?? "");
    if (rightAuth > leftAuth) {
      return rightIso ? (normalizeDatePart(right) ?? right) : right;
    }
    if (leftAuth > rightAuth) {
      return leftIso ? (normalizeDatePart(left) ?? left) : left;
    }
  }

  if (right.length > left.length * 1.5) return right;
  return leftIso ? (normalizeDatePart(left) ?? left) : left;
}

/** Prefer known mode from the higher-authority source. */
export function preferMode(
  existing?: string | null,
  incoming?: string | null,
  existingSource?: string,
  incomingSource?: string,
): string | undefined {
  const leftOk = existing && existing !== "unknown" ? existing : undefined;
  const rightOk = incoming && incoming !== "unknown" ? incoming : undefined;
  if (!leftOk) return rightOk;
  if (!rightOk) return leftOk;
  if (
    sourceAuthority(incomingSource ?? "") > sourceAuthority(existingSource ?? "")
  ) {
    return rightOk;
  }
  return leftOk;
}

