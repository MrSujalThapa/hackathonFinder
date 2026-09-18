/**
 * Same-origin check for mutation CSRF protection.
 *
 * The app is served two ways at once:
 * - directly on loopback (`localhost` vs `127.0.0.1` vs `::1` are equivalent),
 * - through the configured public base URL (Tailscale Serve), where the
 *   browser Origin is `https://<tailnet-host>` while the internal request URL
 *   is a loopback URL (and the Host may carry the public name with the wrong
 *   scheme after proxying).
 *
 * Comparing raw origins therefore rejects legitimate same-app mutations.
 * This helper treats the loopback family as one host and additionally trusts
 * the configured `APP_BASE_URL` / `NEXT_PUBLIC_APP_URL` host.
 */
function hostKey(url: URL): string | null {
  try {
    let host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]"
    ) {
      host = "loopback";
    }
    if (!host) return null;
    const port =
      url.port ||
      (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "");
    return `${host}:${port}`;
  } catch {
    return null;
  }
}

function configuredBaseHosts(): string[] {
  const hosts: string[] = [];
  for (const raw of [process.env.APP_BASE_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    if (!raw) continue;
    try {
      const key = hostKey(new URL(raw));
      if (key) hosts.push(key);
    } catch {
      // A malformed configured URL must never open mutations; ignore it.
    }
  }
  return hosts;
}

export function isSameOriginRequest(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader) return false;
  let originKey: string | null;
  let targetKey: string | null;
  try {
    originKey = hostKey(new URL(originHeader));
    targetKey = hostKey(new URL(request.url));
  } catch {
    return false;
  }
  if (!originKey || !targetKey) return false;
  if (originKey === targetKey) return true;
  return configuredBaseHosts().includes(originKey);
}
