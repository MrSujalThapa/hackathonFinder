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
