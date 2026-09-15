import { z } from "zod";
import { fail, ok, validationError } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { getProfile, saveProfile } from "@/server/applications/repository";
const schema = z.object({ fields: z.record(z.string().max(64), z.string().max(10_000)) });
export async function GET() { try { return ok({ profile: await getProfile() }); } catch { return fail("INTERNAL_ERROR", "Could not load profile.", 500); } }
export async function PUT(request: Request) { const denied = protectApiRequest(request, { requireSameOrigin: true, maxBodyBytes: 100_000, rateLimit: { key: "profile", limit: 20, windowMs: 60_000 } }); if (denied) return denied; const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return validationError(parsed.error); try { return ok({ profile: await saveProfile(parsed.data.fields) }); } catch { return fail("INTERNAL_ERROR", "Could not save profile.", 500); } }
