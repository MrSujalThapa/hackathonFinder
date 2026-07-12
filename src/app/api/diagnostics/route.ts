import { fail, ok } from "@/server/api/envelope";
import { getOwnerDiagnostics } from "@/server/diagnostics";

export async function GET(): Promise<Response> {
  try {
    return ok(await getOwnerDiagnostics(), {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return fail("INTERNAL_ERROR", "Failed to load diagnostics", 500);
  }
}
