import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

export function hashOwnerPassword(password: string): string {
  if (password.length < 12) {
    throw new Error("Owner password must be at least 12 characters.");
  }
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "scrypt",
    "1",
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/** Env-safe encoding of the scrypt hash (no `$` delimiters). */
export function encodeOwnerPasswordHashB64(encodedHash: string): string {
  return Buffer.from(encodedHash, "utf8").toString("base64url");
}

export function decodeOwnerPasswordHashB64(value: string): string | null {
  try {
    const decoded = Buffer.from(value.trim(), "base64url").toString("utf8");
    if (!decoded.startsWith("scrypt$")) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Resolve the scrypt hash string from env.
 * Prefers APP_OWNER_PASSWORD_HASH_B64 when set.
 */
export function resolveOwnerPasswordHash(env: {
  APP_OWNER_PASSWORD_HASH_B64?: string;
  APP_OWNER_PASSWORD_HASH?: string;
}): { hash: string; source: "b64" | "legacy" } | null {
  const b64 = env.APP_OWNER_PASSWORD_HASH_B64?.trim();
  if (b64) {
    const decoded = decodeOwnerPasswordHashB64(b64);
    if (!decoded) {
      throw new Error(
        "APP_OWNER_PASSWORD_HASH_B64 is malformed. Re-run npm run hash:password.",
      );
    }
    return { hash: decoded, source: "b64" };
  }

  const legacy = env.APP_OWNER_PASSWORD_HASH?.trim();
  if (legacy) {
    // Tolerate accidental wrapping quotes from .env files
    const unquoted = legacy.replace(/^["']|["']$/g, "");
    return { hash: unquoted, source: "legacy" };
  }

  return null;
}

export function verifyOwnerPassword(password: string, encodedHash: string): boolean {
  const [scheme, version, n, r, p, salt, hash] = encodedHash.split("$");
  if (scheme !== "scrypt" || version !== "1" || !salt || !hash) return false;

  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(password, Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
