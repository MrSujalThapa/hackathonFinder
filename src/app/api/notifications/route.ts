import { fail, ok } from "@/server/api/envelope";
import { listNotifications } from "@/server/notifications/service";
export async function GET() { try { return ok({ notifications: await listNotifications() }); } catch { return fail("INTERNAL_ERROR", "Could not load notifications.", 500); } }
