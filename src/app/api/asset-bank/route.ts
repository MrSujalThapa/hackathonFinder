import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fail, ok, validationError } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { deleteAssetBank, listAssetBank, upsertAssetBank } from "@/server/applications/repository";

const schema = z.object({ id: z.string().uuid().optional(), label: z.string().min(1).max(120), kind: z.enum(["file", "link"]), assetType: z.string().min(1).max(80), value: z.string().min(1).max(2_000), filename: z.string().max(255).nullable().optional(), notes: z.string().max(2_000).nullable().optional(), isDefault: z.boolean().default(false) });
export async function GET() { try { return ok({ assets: await listAssetBank() }); } catch { return fail("INTERNAL_ERROR", "Could not load Asset Bank.", 500); } }
export async function POST(request: Request) { const denied = protectApiRequest(request, { requireSameOrigin: true, maxBodyBytes: 10_000, rateLimit: { key: "asset-bank", limit: 30, windowMs: 60_000 } }); if (denied) return denied; const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return validationError(parsed.error); try { return ok({ asset: await upsertAssetBank({ ...parsed.data, id: parsed.data.id ?? randomUUID(), filename: parsed.data.filename ?? null, notes: parsed.data.notes ?? null }) }); } catch { return fail("INTERNAL_ERROR", "Could not save Asset Bank entry.", 500); } }
export async function DELETE(request: Request) { const id = new URL(request.url).searchParams.get("id"); if (!id || !z.string().uuid().safeParse(id).success) return fail("VALIDATION_ERROR", "Invalid Asset Bank id.", 400); const denied = protectApiRequest(request, { requireSameOrigin: true, rateLimit: { key: "asset-bank", limit: 30, windowMs: 60_000 } }); if (denied) return denied; try { await deleteAssetBank(id); return ok({ deleted: true }); } catch { return fail("INTERNAL_ERROR", "Could not delete Asset Bank entry.", 500); } }
