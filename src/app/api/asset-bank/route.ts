import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fail, ok, validationError } from "@/server/api/envelope";
import { protectApiRequest } from "@/server/api/protection";
import { deleteAssetBank, listAssetBank, upsertAssetBank } from "@/server/applications/repository";
import { deleteStoredAsset, uploadAssetFile } from "@/server/applications/assetStorage";

const schema = z.object({ id: z.string().uuid().optional(), label: z.string().min(1).max(120), kind: z.enum(["file", "link"]), assetType: z.string().min(1).max(80), value: z.string().min(1).max(2_000), filename: z.string().max(255).nullable().optional(), notes: z.string().max(2_000).nullable().optional(), isDefault: z.boolean().default(false) });
export async function GET() { try { return ok({ assets: await listAssetBank() }); } catch { return fail("INTERNAL_ERROR", "Could not load Asset Bank.", 500); } }
export async function POST(request: Request) { const denied = protectApiRequest(request, { requireSameOrigin: true, maxBodyBytes: 10_000, rateLimit: { key: "asset-bank", limit: 30, windowMs: 60_000 } }); if (denied) return denied; const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return validationError(parsed.error); try { return ok({ asset: await upsertAssetBank({ ...parsed.data, id: parsed.data.id ?? randomUUID(), filename: parsed.data.filename ?? null, notes: parsed.data.notes ?? null }) }); } catch { return fail("INTERNAL_ERROR", "Could not save Asset Bank entry.", 500); } }
export async function DELETE(request: Request) { const id = new URL(request.url).searchParams.get("id"); if (!id || !z.string().uuid().safeParse(id).success) return fail("VALIDATION_ERROR", "Invalid Asset Bank id.", 400); const denied = protectApiRequest(request, { requireSameOrigin: true, rateLimit: { key: "asset-bank", limit: 30, windowMs: 60_000 } }); if (denied) return denied; try { const existing = (await listAssetBank()).find((asset) => asset.id === id); if (existing) await deleteStoredAsset(existing.value); await deleteAssetBank(id); return ok({ deleted: true }); } catch { return fail("INTERNAL_ERROR", "Could not delete Asset Bank entry.", 500); } }

const uploadSchema = z.object({ id: z.string().uuid().optional(), label: z.string().min(1).max(120), assetType: z.string().min(1).max(80), isDefault: z.enum(["true", "false"]).optional() });
export async function PUT(request: Request) {
  const denied = protectApiRequest(request, { requireSameOrigin: true, maxBodyBytes: 13_000_000, rateLimit: { key: "asset-bank-upload", limit: 15, windowMs: 60_000 } }); if (denied) return denied;
  const form = await request.formData().catch(() => null); if (!form) return fail("VALIDATION_ERROR", "Expected an upload form.", 400);
  const parsed = uploadSchema.safeParse({ id: form.get("id") || undefined, label: form.get("label"), assetType: form.get("assetType"), isDefault: form.get("isDefault") || undefined });
  const file = form.get("file"); if (!parsed.success || !(file instanceof File) || file.size === 0) return fail("VALIDATION_ERROR", "Choose a non-empty file to upload.", 400);
  if (file.size > 12 * 1024 * 1024) return fail("VALIDATION_ERROR", "Files must be 12 MB or smaller.", 400);
  const id = parsed.data.id ?? randomUUID();
  try { const uploaded = await uploadAssetFile({ assetId: id, filename: file.name, file }); const asset = await upsertAssetBank({ id, label: parsed.data.label, kind: "file", assetType: parsed.data.assetType, value: uploaded.value, filename: uploaded.filename, notes: JSON.stringify({ size: file.size, mimeType: file.type || "application/octet-stream", uploadedAt: new Date().toISOString() }), isDefault: parsed.data.isDefault === "true" }); return ok({ asset }, { status: 201 }); } catch (error) { return fail("INTERNAL_ERROR", error instanceof Error ? error.message : "Could not upload asset.", 500); }
}
