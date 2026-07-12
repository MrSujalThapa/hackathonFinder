import {
  candidateIdSchema,
  decisionBodySchema,
  fail,
  ok,
  statusForAction,
  validationError,
} from "@/server/api/envelope";
import { getCandidateRepository } from "@/server/candidates/service";
import { timedAsync } from "@/lib/perf/timing";
import { protectApiRequest } from "@/server/api/protection";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Status-only decision handler.
 *
 * Google Sheets reconciliation is intentionally NOT awaited here.
 * Clients call POST /api/candidates/[id]/sync-sheet afterward so the next
 * queue card becomes usable immediately. Status persistence remains required;
 * Sheet failures must not roll back APPROVED/REJECTED/etc.
 */
async function applyDecision(
  request: Request,
  context: RouteContext,
  action: "approve" | "reject" | "save" | "restore",
): Promise<Response> {
  try {
    const protection = protectApiRequest(request, {
      requireSameOrigin: true,
      maxBodyBytes: 2_048,
      rateLimit: { key: "candidate-status", limit: 60, windowMs: 60_000 },
    });
    if (protection) return protection;

    const { id } = await context.params;
    const parsedId = candidateIdSchema.safeParse(id);
    if (!parsedId.success) {
      return validationError(parsedId.error);
    }

    let reason: string | undefined;
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const raw = await request.json().catch(() => ({}));
      const parsedBody = decisionBodySchema.safeParse(raw ?? {});
      if (!parsedBody.success) {
        return validationError(parsedBody.error);
      }
      reason = parsedBody.data.reason;
    }

    const repo = getCandidateRepository();
    const existing = await repo.getCandidate(parsedId.data);
    if (!existing) {
      return fail("CANDIDATE_NOT_FOUND", "Candidate not found", 404);
    }

    const newStatus = statusForAction(action);
    const candidate = await timedAsync("server.status_mutation", () =>
      repo.updateCandidateStatus(parsedId.data, newStatus, {
        reason,
        metadata: { via: "api", action },
      }),
    );

    return ok({
      candidate,
      previousStatus: existing.status,
      newStatus: candidate.status,
      action,
      // Sheet sync is a separate client follow-up via /sync-sheet.
      sheetSync: null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update candidate";
    if (message.startsWith("Candidate not found")) {
      return fail("CANDIDATE_NOT_FOUND", message, 404);
    }
    return fail("INTERNAL_ERROR", message, 500);
  }
}

export function createDecisionHandler(
  action: "approve" | "reject" | "save" | "restore",
) {
  return (request: Request, context: RouteContext) =>
    applyDecision(request, context, action);
}
