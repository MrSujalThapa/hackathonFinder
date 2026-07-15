import { createHash, timingSafeEqual } from "node:crypto";

export function resolveOwnerPassword(env: { APP_PASSWORD?: string }): string {
  const password = env.APP_PASSWORD;
  if (!password) {
    throw new Error("APP_PASSWORD is required for owner authentication.");
  }
  return password;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function verifyOwnerPassword(inputPassword: string, expectedPassword: string): boolean {
  return timingSafeEqual(digest(inputPassword), digest(expectedPassword));
}
