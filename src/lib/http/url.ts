export function normalizeUrl(url: string, base?: string): string | undefined {
  try {
    const resolved = base ? new URL(url, base) : new URL(url);
    resolved.hash = "";
    return resolved.toString();
  } catch {
    return undefined;
  }
}

export function normalizeUrlForDedupe(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${parsed.hostname}${pathname}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function uniqueUrls(urls: string[], base?: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of urls) {
    const normalized = normalizeUrl(raw, base);
    if (!normalized || !isHttpUrl(normalized)) continue;

    const key = normalizeUrlForDedupe(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
