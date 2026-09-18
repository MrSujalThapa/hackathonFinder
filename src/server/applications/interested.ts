import type { CandidateCard } from "@/core/candidates/types";
import type { ApplicationDraft } from "@/core/applications/types";

export type InterestedResult = { state: "drafted" | "scheduled" | "unavailable"; application?: ApplicationDraft };
export async function startInterestedApplication(candidate: CandidateCard, prepare: (input: { candidateId: string; applicationUrl: string }) => Promise<{ application: ApplicationDraft }>, now = new Date()): Promise<InterestedResult> {
  if (!candidate.applyUrl) return { state: "unavailable" };
  const opensAt = candidate.applicationOpensAt ? new Date(candidate.applicationOpensAt) : null;
  if (opensAt && opensAt > now) return { state: "scheduled" };
  const prepared = await prepare({ candidateId: candidate.id, applicationUrl: candidate.applyUrl });
  return { state: "drafted", application: prepared.application };
}
