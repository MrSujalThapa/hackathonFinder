import { fail } from "@/server/api/envelope";
import { downloadAssetFile } from "@/server/applications/assetStorage";
import { listAssetBank } from "@/server/applications/repository";

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return fail("VALIDATION_ERROR", "Missing asset id.", 400);
  try {
    const asset = (await listAssetBank()).find((entry) => entry.id === id);
    if (!asset || asset.kind !== "file") return fail("CANDIDATE_NOT_FOUND", "Asset not found.", 404);
    const file = await downloadAssetFile(asset.value);
    if (!file) return fail("VALIDATION_ERROR", "This file is not stored in Asset Bank storage.", 400);
    return new Response(file.data, { headers: { "Content-Type": file.data.type || "application/octet-stream", "Content-Disposition": `inline; filename="${file.filename.replaceAll('"', "")}"`, "Cache-Control": "private, no-store" } });
  } catch { return fail("INTERNAL_ERROR", "Could not retrieve asset.", 500); }
}
