import { fail } from "@/server/api/envelope";

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

type ProtectionOptions = {
  rateLimit?: RateLimitOptions;
  maxBodyBytes?: number;
  requireSameOrigin?: boolean;
};

const buckets = new Map<string, { count: number; resetAt: number }>();

export function getClientKey(request: Request): string {
  // Vercel sets x-forwarded-for. In local/dev this falls back to a shared key.
  // Do not use this as identity or authorization; it is only a coarse limiter key.
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local"
  );
}

export function checkRateLimit({
  key,
  limit,
  windowMs,
}: RateLimitOptions): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  return origin === new URL(request.url).origin;
}

function contentLengthOk(request: Request, maxBodyBytes: number): boolean {
  const raw = request.headers.get("content-length");
  if (!raw) return true;
  const length = Number(raw);
  return Number.isFinite(length) && length <= maxBodyBytes;
}

export function protectApiRequest(
  request: Request,
  options: ProtectionOptions,
): Response | null {
  if (options.requireSameOrigin && !isSameOrigin(request)) {
    return fail("FORBIDDEN", "Cross-origin mutation rejected.", 403);
  }

  if (
    options.maxBodyBytes != null &&
    !contentLengthOk(request, options.maxBodyBytes)
  ) {
    return fail("PAYLOAD_TOO_LARGE", "Request body is too large.", 413);
  }

  if (options.rateLimit) {
    const key = `${options.rateLimit.key}:${getClientKey(request)}`;
    if (!checkRateLimit({ ...options.rateLimit, key })) {
      return fail("RATE_LIMITED", "Too many requests. Try again later.", 429);
    }
  }

  return null;
}
