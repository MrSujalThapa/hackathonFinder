import { NextResponse } from "next/server";
import { getServerEnv } from "@/config/env";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

export async function POST(): Promise<Response> {
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
