export const SESSION_COOKIE_NAME = "haa_owner_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 12;

type SessionPayload = {
  sub: "owner";
  iat: number;
  exp: number;
  v: 1;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeJson(value: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJson<T>(value: string): T | null {
  try {
    const bytes = base64UrlToBytes(value);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await signingKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export function getSessionSecret(): string | null {
  return process.env.APP_SESSION_SECRET?.trim() || null;
}

export async function createSessionToken(
  secret: string,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload = encodeJson({
    sub: "owner",
    iat: now,
    exp: now + SESSION_DURATION_SECONDS,
    v: 1,
  } satisfies SessionPayload);
  const signature = await signPayload(payload, secret);
  return `${payload}.${signature}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string | null = getSessionSecret(),
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!token || !secret || secret.length < 32) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expected = await signPayload(payload, secret);
  if (expected !== signature) return false;

  const decoded = decodeJson<SessionPayload>(payload);
  if (!decoded || decoded.sub !== "owner" || decoded.v !== 1) return false;
  return decoded.exp > now;
}
