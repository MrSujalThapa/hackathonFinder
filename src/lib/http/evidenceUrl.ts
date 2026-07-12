/**
 * Evidence URL identity for dedupe.
 * Keeps meaningful query params; strips fragments, trailing slashes,
 * utm_* / common tracking params, and sorts remaining query keys.
 */

const TRACKING_PARAM_PREFIXES = ["utm_"];
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "ref",
  "ref_src",
  "s",
  "si",
]);

function shouldDropParam(key: string): boolean {
  const lower = key.toLowerCase();
  if (TRACKING_PARAMS.has(lower)) return true;
  return TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Canonical key used for (candidate_id, type, url_key) uniqueness.
 * Empty string when URL is missing/invalid — still forms a valid unique key
 * with type so null-url evidence of the same type collapses.
 */
export function normalizeEvidenceUrlKey(url: string | null | undefined): string {
  if (!url || !url.trim()) return "";

  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";

    const kept = [...parsed.searchParams.entries()]
      .filter(([key]) => !shouldDropParam(key))
      .sort(([aKey, aVal], [bKey, bVal]) => {
        const keyCmp = aKey.localeCompare(bKey);
        return keyCmp !== 0 ? keyCmp : aVal.localeCompare(bVal);
      });

    parsed.search = "";
    for (const [key, value] of kept) {
      parsed.searchParams.append(key, value);
    }

    // Stable string without default ports noise
    const port =
      parsed.port &&
      !((parsed.protocol === "https:" && parsed.port === "443") ||
        (parsed.protocol === "http:" && parsed.port === "80"))
        ? `:${parsed.port}`
        : "";

    const search = parsed.searchParams.toString();
    return `${parsed.protocol}//${parsed.hostname}${port}${parsed.pathname}${
      search ? `?${search}` : ""
    }`;
  } catch {
    return url.trim().toLowerCase().replace(/\/+$/, "");
  }
}
