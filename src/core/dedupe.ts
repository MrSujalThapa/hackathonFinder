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
