import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/auth/session";

const PROTECTED_PAGE_PREFIXES = [
  "/queue",
  "/approved",
  "/rejected",
  "/saved",
  "/candidate",
  "/settings",
  "/terminal",
];

const PROTECTED_API_PREFIXES = [
  "/api/candidates",
  "/api/sheets",
  "/api/diagnostics",
  "/api/discovery",
  "/api/sources",
  "/api/dev/reset-mock",
];

function isProtectedPage(pathname: string): boolean {
  return PROTECTED_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isProtectedApi(pathname: string): boolean {
  return PROTECTED_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function sameOriginMutation(request: NextRequest): boolean {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return true;
  }
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === request.nextUrl.origin);
}

function unauthorizedApi(status = 401, message = "Authentication required."): Response {
  return NextResponse.json(
    { data: null, error: { code: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED", message } },
    { status },
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const protectedPage = isProtectedPage(pathname);
  const protectedApi = isProtectedApi(pathname);
  if (!protectedPage && !protectedApi) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authenticated = await verifySessionToken(token);
  if (!authenticated) {
    if (protectedApi) return unauthorizedApi();
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(loginUrl);
  }

  if (protectedApi && !sameOriginMutation(request)) {
    return unauthorizedApi(403, "Cross-origin mutation rejected.");
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
