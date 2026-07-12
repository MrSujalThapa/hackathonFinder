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

export function createSourceIdIdentity(
  sourceIds?: Record<string, unknown>,
): string | null {
  if (!sourceIds) return null;

  const parts = Object.entries(sourceIds)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${normalizeText(String(value))}`);

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

export function softEventsMatch(left: FingerprintInput, right: FingerprintInput): boolean {
  if (fingerprintsMatch(left, right)) return true;
  const leftKey = createSoftEventKey(left);
  const rightKey = createSoftEventKey(right);
  if (leftKey && rightKey && leftKey === rightKey) return true;

  // Web/search result pointing at the same listing/official host+path stem.
  const leftUrl = normalizeUrl(left.officialUrl) ?? normalizeUrl(left.applyUrl);
  const rightUrl = normalizeUrl(right.officialUrl) ?? normalizeUrl(right.applyUrl);
  if (leftUrl && rightUrl && leftUrl === rightUrl) return true;

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

/** Prefer ISO-looking dates and non-empty stronger values over weak/empty. */
export function preferStrongerText(
  existing?: string | null,
  incoming?: string | null,
): string | undefined {
  const left = existing?.trim() || undefined;
  const right = incoming?.trim() || undefined;
  if (!left) return right;
  if (!right) return left;

  const leftIso = Boolean(normalizeDatePart(left)?.match(/^\d{4}-\d{2}-\d{2}$/));
  const rightIso = Boolean(normalizeDatePart(right)?.match(/^\d{4}-\d{2}-\d{2}$/));
  if (rightIso && !leftIso) return normalizeDatePart(right) ?? right;
  if (leftIso && !rightIso) return normalizeDatePart(left) ?? left;
  if (right.length > left.length * 1.5) return right;
  return left;
}

