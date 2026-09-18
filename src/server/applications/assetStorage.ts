import { basename, extname } from "node:path";
import { createServiceSupabaseClient } from "@/lib/supabase/createServiceClient";

export const ASSET_BUCKET = "hackfinder-assets";
const STORAGE_PREFIX = `supabase://${ASSET_BUCKET}/`;

export function isStoredAsset(value: string): boolean {
  return value.startsWith(STORAGE_PREFIX);
}

export function storagePathFromAssetValue(value: string): string | null {
  return isStoredAsset(value) ? value.slice(STORAGE_PREFIX.length) : null;
}

function safeFilename(filename: string): string {
  const name = basename(filename).replace(/[^a-zA-Z0-9._-]/g, "-");
  return name || `upload${extname(filename)}`;
}

async function ensureBucket(): Promise<void> {
  const storage = createServiceSupabaseClient().storage;
  const { data, error } = await storage.getBucket(ASSET_BUCKET);
  if (data) return;
  if (error && !/not found|does not exist/i.test(error.message)) {
    throw new Error(`Could not access asset storage: ${error.message}`);
  }
  const created = await storage.createBucket(ASSET_BUCKET, {
    public: false,
    fileSizeLimit: "12582912",
    allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  });
  if (created.error && !/already exists/i.test(created.error.message)) {
    throw new Error(`Could not create asset storage: ${created.error.message}`);
  }
}

export async function uploadAssetFile(input: { assetId: string; filename: string; file: File }): Promise<{ value: string; filename: string }> {
  await ensureBucket();
  const filename = safeFilename(input.filename);
  const path = `${input.assetId}/${Date.now()}-${filename}`;
  const { error } = await createServiceSupabaseClient().storage
    .from(ASSET_BUCKET)
    .upload(path, Buffer.from(await input.file.arrayBuffer()), {
      contentType: input.file.type || "application/octet-stream",
      upsert: false,
    });
  if (error) throw new Error(`Could not upload asset: ${error.message}`);
  return { value: `${STORAGE_PREFIX}${path}`, filename };
}

export async function downloadAssetFile(value: string): Promise<{ data: Blob; filename: string } | null> {
  const path = storagePathFromAssetValue(value);
  if (!path) return null;
  const { data, error } = await createServiceSupabaseClient().storage.from(ASSET_BUCKET).download(path);
  if (error || !data) throw new Error(`Could not download asset: ${error?.message ?? "missing file"}`);
  return { data, filename: basename(path).replace(/^\d+-/, "") };
}

export async function deleteStoredAsset(value: string): Promise<void> {
  const path = storagePathFromAssetValue(value);
  if (!path) return;
  const { error } = await createServiceSupabaseClient().storage.from(ASSET_BUCKET).remove([path]);
  if (error) throw new Error(`Could not delete stored asset: ${error.message}`);
}
