export function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function cleanText(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value).replace(/\s+/g, " ").trim();
    return text || undefined;
  }
  if (isPlainRecord(value)) {
    const preferred =
      value.name ??
      value.title ??
      value.label ??
      value.city ??
      value.country ??
      value.text ??
      value.value;
    return cleanText(preferred);
  }
  return undefined;
}

export function valueAtPath(record: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  let current = record;
  const parts = path.split(".").flatMap((part) => {
    const matches = [...part.matchAll(/([^\[\]]+)|\[(\d+)\]/g)];
    return matches.map((match) => match[1] ?? Number(match[2]));
  });
  for (const part of parts) {
    if (typeof part === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[part];
      continue;
    }
    if (!isPlainRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

export function readArrayAtPath(payload: unknown, path: string): unknown[] | null {
  if (!path) return Array.isArray(payload) ? payload : null;
  const value = valueAtPath(payload, path);
  return Array.isArray(value) ? value : null;
}

export function flattenRecordKeys(
  record: Record<string, unknown>,
  prefix = "",
  depth = 0,
  maxDepth = 3,
): string[] {
  if (depth > maxDepth) return [];
  const keys: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    keys.push(path);
    if (isPlainRecord(value)) {
      keys.push(...flattenRecordKeys(value, path, depth + 1, maxDepth));
    }
  }
  return keys;
}

export function boundedJson(value: unknown, max = 600): string {
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return "";
  }
}

export function normalizeRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(Math.max(0, Math.min(1, value)).toFixed(3));
}

export function parseDateish(value: unknown): string | undefined {
  const text = cleanText(value);
  if (!text) return undefined;
  const numeric = typeof value === "number" ? value : Number(text);
  if (Number.isFinite(numeric) && numeric > 1_000_000_000) {
    const ms = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const isoDate = text.match(/\b(20\d{2}-\d{2}-\d{2}(?:[T ][0-9:.+-Z]*)?)\b/)?.[1];
  if (isoDate) {
    const date = new Date(isoDate);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
    return isoDate;
  }
  const namedDate = text.match(
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+20\d{2}\b/i,
  )?.[0];
  if (namedDate) {
    const date = new Date(namedDate);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return undefined;
}

export function stableDedupeKey(parts: Array<string | undefined>): string {
  return parts
    .filter(Boolean)
    .join("|")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function isLikelyUrl(value: string): boolean {
  return /^(?:https?:)?\/\//i.test(value) || /^\/[^\s]+$/.test(value);
}

export function isSafePublicOrigin(url: string, allowedOrigins: string[]): boolean {
  try {
    const parsed = new URL(url);
    return allowedOrigins.includes(parsed.origin);
  } catch {
    return false;
  }
}
