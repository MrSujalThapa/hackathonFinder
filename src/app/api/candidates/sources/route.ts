import { fail, ok } from "@/server/api/envelope";
import { getCandidateRepository } from "@/server/candidates/service";
import { listCustomSources } from "@/server/customSources/repository";
import { withRequestLogging } from "@/server/observability/logger";

export async function GET(request: Request): Promise<Response> {
  return withRequestLogging(request, "GET /api/candidates/sources", async () => {
    try {
      const repo = getCandidateRepository();
      const sources = repo.listPendingSources
        ? await repo.listPendingSources()
        : [];
      const customIds = sources.filter((source) => source.startsWith("custom:"));
      const customSources =
        customIds.length > 0
          ? await listCustomSources().catch(() => [])
          : [];
      const customById = new Map(
        customSources.map((source) => [`custom:${source.slug}`, source]),
      );
      const sourceMetadata = customIds.map((id) => ({
        id,
        label: customById.get(id)?.name ?? id.slice("custom:".length),
        kind: "custom" as const,
      }));
      return ok({ sources, sourceMetadata });
    } catch {
      return fail("INTERNAL_ERROR", "Failed to list pending candidate sources", 500);
    }
  });
}
