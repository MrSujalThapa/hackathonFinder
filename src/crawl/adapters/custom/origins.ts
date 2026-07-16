/** Match Phase 5.6 / 6.1: allow www and apex origins for safe pagination/actions. */
export function originVariants(origin: string): string[] {
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname;
    const variants = new Set([parsed.origin]);
    if (host.startsWith("www.")) {
      variants.add(
        `${parsed.protocol}//${host.slice(4)}${parsed.port ? `:${parsed.port}` : ""}`,
      );
    } else if (host.includes(".")) {
      variants.add(
        `${parsed.protocol}//www.${host}${parsed.port ? `:${parsed.port}` : ""}`,
      );
    }
    return [...variants];
  } catch {
    return [origin];
  }
}

export function isOriginAllowed(url: string, allowedOrigins: string[]): boolean {
  try {
    const origin = new URL(url).origin;
    return allowedOrigins.some((allowed) => {
      try {
        return new URL(allowed).origin === origin;
      } catch {
        return allowed === origin;
      }
    });
  } catch {
    return false;
  }
}

const BLOCKED_HOSTS = [/dorahacks\.io$/i];

export function isBlockedCustomSourceUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    return BLOCKED_HOSTS.some((pattern) => pattern.test(host));
  } catch {
    return false;
  }
}
