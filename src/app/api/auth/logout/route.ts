import { NextResponse } from "next/server";
import { getServerEnv } from "@/config/env";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { protectApiRequest } from "@/server/api/protection";

export async function POST(request: Request): Promise<Response> {
  const protection = protectApiRequest(request, {
    requireSameOrigin: true,
    maxBodyBytes: 256,
    rateLimit: { key: "logout", limit: 20, windowMs: 60_000 },
  });
  if (protection) return protection;

  const env = getServerEnv();
  const response = NextResponse.json({ data: { ok: true }, error: null });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
