import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { fail } from "@/server/api/envelope";

export async function requireOwnerSession(
  request: Request,
): Promise<Response | null> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`),
  );
  const token = match?.[1] ? decodeURIComponent(match[1]) : undefined;
  const ok = await verifySessionToken(token);
  if (!ok) {
    return fail("UNAUTHORIZED", "Authentication required.", 401);
  }
  return null;
}
