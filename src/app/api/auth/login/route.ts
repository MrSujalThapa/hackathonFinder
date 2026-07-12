import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@/config/env";
import { verifyOwnerPassword } from "@/lib/auth/password";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_SECONDS,
} from "@/lib/auth/session";

const bodySchema = z.object({
  password: z.string().min(1).max(500),
});

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function clientKey(request: Request): string {
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local"
  );
}

function tooManyAttempts(key: string): boolean {
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || record.resetAt < now) {
    attempts.set(key, { count: 0, resetAt: now + WINDOW_MS });
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || record.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  record.count += 1;
}

export async function POST(request: Request): Promise<Response> {
  const key = clientKey(request);
  if (tooManyAttempts(key)) {
    return NextResponse.json(
      { data: null, error: { code: "RATE_LIMITED", message: "Try again later." } },
      { status: 429 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    recordFailure(key);
    return NextResponse.json(
      { data: null, error: { code: "AUTH_FAILED", message: "Invalid credentials." } },
      { status: 401 },
    );
  }

  const env = getServerEnv();
  const hash = env.APP_OWNER_PASSWORD_HASH;
  const secret = env.APP_SESSION_SECRET;
  if (!hash || !secret || secret.length < 32) {
    return NextResponse.json(
      { data: null, error: { code: "AUTH_NOT_CONFIGURED", message: "Owner access is not configured." } },
      { status: 503 },
    );
  }

  if (!verifyOwnerPassword(parsed.data.password, hash)) {
    recordFailure(key);
    return NextResponse.json(
      { data: null, error: { code: "AUTH_FAILED", message: "Invalid credentials." } },
      { status: 401 },
    );
  }

  attempts.delete(key);
  const response = NextResponse.json({ data: { ok: true }, error: null });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: await createSessionToken(secret),
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
  return response;
}
