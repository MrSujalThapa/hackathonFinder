import { z } from "zod";
import type { CandidateStatus } from "@/lib/supabase/database.types";

export const candidateStatusSchema = z.enum([
  "NEW",
  "NEEDS_REVIEW",
  "APPROVED",
  "REJECTED",
  "SAVED_FOR_LATER",
  "EXPIRED",
  "DUPLICATE",
  "ERROR",
]);

const BUILTIN_DISCOVERY_SOURCE_IDS = new Set([
  "mlh",
  "web",
  "hacklist",
  "devpost",
  "luma",
  "hakku",
  "mock",
]);

export function isValidDiscoverySourceId(value: string): boolean {
  if (value.length > 96 || /\s|[\\/]|[\u0000-\u001f\u007f]/.test(value)) return false;
  if (BUILTIN_DISCOVERY_SOURCE_IDS.has(value)) return true;
  return /^custom:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export const listCandidatesQuerySchema = z.object({
  status: candidateStatusSchema.optional(),
  statuses: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value?.trim()) return undefined;
      const parsed: CandidateStatus[] = [];
      for (const raw of value.split(",")) {
        const status = candidateStatusSchema.safeParse(raw.trim());
        if (!status.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid candidate status: ${raw}`,
          });
          return z.NEVER;
        }
        parsed.push(status.data);
      }
      return [...new Set(parsed)];
    }),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  cursor: z.string().min(1).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  source: z.string().min(1).refine(isValidDiscoverySourceId, "Invalid source id").optional(),
  sort: z.enum(["score", "found_at", "name"]).optional().default("score"),
  q: z.string().optional(),
});

export const candidateIdSchema = z.string().uuid("Invalid candidate id");

export const decisionBodySchema = z.object({
  reason: z.string().max(500).optional(),
});

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "CANDIDATE_NOT_FOUND"
  | "INTERNAL_ERROR"
  | "MOCK_MODE_REQUIRED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED";

export type ApiError = {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
};

export type ApiEnvelope<T> = {
  data: T | null;
  error: ApiError | null;
};

export function ok<T>(data: T, init?: ResponseInit): Response {
  const body: ApiEnvelope<T> = { data, error: null };
  return Response.json(body, { status: init?.status ?? 200, ...init });
}

export function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: unknown,
): Response {
  const body: ApiEnvelope<null> = {
    data: null,
    error: { code, message, details },
  };
  return Response.json(body, { status });
}

export function validationError(error: z.ZodError): Response {
  return fail("VALIDATION_ERROR", "Invalid request", 400, error.flatten());
}

export function statusForAction(
  action: "approve" | "reject" | "save" | "restore",
): CandidateStatus {
  switch (action) {
    case "approve":
      return "APPROVED";
    case "reject":
      return "REJECTED";
    case "save":
      return "SAVED_FOR_LATER";
    case "restore":
      return "NEW";
  }
}
