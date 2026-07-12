import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@/config/env";
import {
  resolveOwnerPasswordHash,
  verifyOwnerPassword,
} from "@/lib/auth/password";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_SECONDS,
} from "@/lib/auth/session";
import { checkRateLimit, getClientKey } from "@/server/api/protection";

const bodySchema = z.object({
  password: z.string().min(1).max(500),
});

export async function POST(request: Request): Promise<Response> {
  const key = `login:${getClientKey(request)}`;
  if (!checkRateLimit({ key, limit: 5, windowMs: 10 * 60 * 1000 })) {
    return NextResponse.json(
      { data: null, error: { code: "RATE_LIMITED", message: "Try again later." } },
      { status: 429 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: { code: "AUTH_FAILED", message: "Invalid credentials." } },
      { status: 401 },
    );
  }

  const env = getServerEnv();
  let resolved;
  try {
    resolved = resolveOwnerPasswordHash(env);
  } catch {
    return NextResponse.json(
      { data: null, error: { code: "AUTH_NOT_CONFIGURED", message: "Owner access is not configured." } },
      { status: 503 },
    );
  }
  const secret = env.APP_SESSION_SECRET;
  if (!resolved || !secret || secret.length < 32) {
    return NextResponse.json(
      { data: null, error: { code: "AUTH_NOT_CONFIGURED", message: "Owner access is not configured." } },
      { status: 503 },
    );
  }

  if (!verifyOwnerPassword(parsed.data.password, resolved.hash)) {
    return NextResponse.json(
      { data: null, error: { code: "AUTH_FAILED", message: "Invalid credentials." } },
      { status: 401 },
    );
  }

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
