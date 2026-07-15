import type { CandidateStatus } from "@/lib/supabase/database.types";

export type CandidateActionId =
  | "approve"
  | "reject"
  | "save"
  | "unsave"
  | "restore";

export type CandidateActionDef = {
  id: CandidateActionId;
  label: string;
  /** Maps to existing decideCandidate / decision API verbs. */
  apiAction: "approve" | "reject" | "save" | "restore";
  tone: "approve" | "reject" | "save" | "neutral";
  /** Primary actions appear first; restore is secondary. */
  priority: "primary" | "secondary";
};

export type CandidateActionSubject = {
  status: CandidateStatus;
};

/**
 * Centralized visible transitions for review UI.
 * Save is modeled as status SAVED_FOR_LATER (not a separate flag).
 * Unsave maps to the existing restore API (returns to NEW / clears saved_at).
 */
export function getCandidateActions(
  candidate: CandidateActionSubject,
): CandidateActionDef[] {
  const { status } = candidate;

  switch (status) {
    case "NEW":
    case "NEEDS_REVIEW":
      return [
        { id: "approve", label: "Approve", apiAction: "approve", tone: "approve", priority: "primary" },
        { id: "save", label: "Save", apiAction: "save", tone: "save", priority: "primary" },
        { id: "reject", label: "Reject", apiAction: "reject", tone: "reject", priority: "primary" },
      ];

    case "APPROVED":
      return [
        { id: "reject", label: "Reject", apiAction: "reject", tone: "reject", priority: "primary" },
        { id: "save", label: "Save", apiAction: "save", tone: "save", priority: "primary" },
        {
          id: "restore",
          label: "Restore to queue",
          apiAction: "restore",
          tone: "neutral",
          priority: "secondary",
        },
      ];

    case "REJECTED":
      return [
        { id: "approve", label: "Approve", apiAction: "approve", tone: "approve", priority: "primary" },
        { id: "save", label: "Save", apiAction: "save", tone: "save", priority: "primary" },
        {
          id: "restore",
          label: "Restore to queue",
          apiAction: "restore",
          tone: "neutral",
          priority: "secondary",
        },
      ];

    case "SAVED_FOR_LATER":
      return [
        { id: "approve", label: "Approve", apiAction: "approve", tone: "approve", priority: "primary" },
        { id: "reject", label: "Reject", apiAction: "reject", tone: "reject", priority: "primary" },
        { id: "unsave", label: "Unsave", apiAction: "restore", tone: "save", priority: "primary" },
        {
          id: "restore",
          label: "Restore to queue",
          apiAction: "restore",
          tone: "neutral",
          priority: "secondary",
        },
      ];

    default:
      // EXPIRED / DUPLICATE / ERROR — allow restore + investigate transitions only
      return [
        {
          id: "restore",
          label: "Restore to queue",
          apiAction: "restore",
          tone: "neutral",
          priority: "secondary",
        },
      ];
  }
}

export function actionIdsFor(candidate: CandidateActionSubject): CandidateActionId[] {
  return getCandidateActions(candidate).map((a) => a.id);
}
