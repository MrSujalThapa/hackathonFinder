import { z } from "zod";
import { fail, ok, validationError } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { listNotifications, setNotificationRead } from "@/server/notifications/service";
export async function GET() { try { return ok({ notifications: await listNotifications() }); } catch { return fail("INTERNAL_ERROR", "Could not load notifications.", 500); } }
const patchSchema = z.object({ id: z.string().uuid(), isRead: z.boolean() });
export async function PATCH(request: Request) { const denied = protectApiRequest(request, { requireSameOrigin: true, maxBodyBytes: 4_000, rateLimit: { key: "notifications", limit: 60, windowMs: 60_000 } }); if (denied) return denied; const parsed = patchSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return validationError(parsed.error); try { await setNotificationRead(parsed.data.id, parsed.data.isRead); return ok({ updated: true }); } catch { return fail("INTERNAL_ERROR", "Could not update notification state.", 500); } }
