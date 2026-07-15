import dns from "node:dns/promises";
import net from "node:net";

const MAX_REDIRECTS = 5;

export type UrlSafetyOptions = {
  allowRawIp?: boolean;
  resolveHost?: (hostname: string) => Promise<string[]>;
  fetchHead?: typeof fetch;
};

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0 ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized === "::" ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  return (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal") ||
    lower === "metadata.google.internal" ||
    lower === "169.254.169.254"
  );
}

function assertSafeParsedUrl(parsed: URL, options: UrlSafetyOptions): void {
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed.");
  }
  if (!parsed.hostname) throw new Error("URL hostname is required.");
  if (isBlockedHostname(parsed.hostname)) {
    throw new Error("Local or internal hostnames are not allowed.");
  }
  const ipKind = net.isIP(parsed.hostname);
  if (ipKind && !options.allowRawIp) {
    throw new Error("Raw IP addresses are not allowed.");
  }
  if (ipKind === 4 && isPrivateIpv4(parsed.hostname)) {
    throw new Error("Private IPv4 destinations are not allowed.");
  }
  if (ipKind === 6 && isPrivateIpv6(parsed.hostname)) {
    throw new Error("Private IPv6 destinations are not allowed.");
  }
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

async function assertSafeDns(parsed: URL, options: UrlSafetyOptions): Promise<void> {
  if (net.isIP(parsed.hostname)) return;
  const addresses = await (options.resolveHost ?? defaultResolveHost)(parsed.hostname);
  if (addresses.length === 0) throw new Error("URL hostname did not resolve.");
  for (const address of addresses) {
    const kind = net.isIP(address);
    if (kind === 4 && isPrivateIpv4(address)) {
      throw new Error("DNS resolves to a private IPv4 destination.");
    }
    if (kind === 6 && isPrivateIpv6(address)) {
      throw new Error("DNS resolves to a private IPv6 destination.");
    }
  }
}

export async function assertSafeCustomSourceUrl(
  rawUrl: string,
  options: UrlSafetyOptions = {},
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL.");
  }
  assertSafeParsedUrl(parsed, options);
  await assertSafeDns(parsed, options);
  return parsed;
}

export async function resolveSafeRedirects(
  rawUrl: string,
  options: UrlSafetyOptions = {},
): Promise<URL> {
  let current = await assertSafeCustomSourceUrl(rawUrl, options);
  const fetchHead = options.fetchHead ?? fetch;

  for (let redirect = 0; redirect < MAX_REDIRECTS; redirect += 1) {
    const response = await fetchHead(current, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) return current;
    current = await assertSafeCustomSourceUrl(new URL(location, current).toString(), options);
  }

  throw new Error("Too many redirects.");
}

export function normalizeCustomSourceSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  if (!slug || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(slug)) {
    throw new Error("Site name must contain letters or numbers.");
  }
  return slug;
}
