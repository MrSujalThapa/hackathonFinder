import type {
  AddActionInput,
  AddEvidenceInput,
  CandidateCard,
  CandidateDetail,
  ListCandidatesParams,
  ListCandidatesResult,
  StatusChangeMetadata,
  UpsertCandidateInput,
  UpsertCandidateResult,
} from "@/core/candidates/types";
import type { CandidateStatus } from "@/lib/supabase/database.types";
import * as supabaseRepo from "@/server/candidates/repository";

export type CandidateRepository = {
  listCandidates: (params?: ListCandidatesParams) => Promise<ListCandidatesResult>;
  getCandidate: (id: string) => Promise<CandidateDetail | null>;
  updateCandidateStatus: (
    id: string,
    status: CandidateStatus,
    metadata?: StatusChangeMetadata,
  ) => Promise<CandidateCard>;
  upsertCandidateByFingerprint?: (
    input: UpsertCandidateInput,
  ) => Promise<UpsertCandidateResult>;
  addEvidence?: (
    candidateId: string,
    evidence: AddEvidenceInput,
  ) => Promise<unknown>;
  addAction?: (candidateId: string, action: AddActionInput) => Promise<unknown>;
};

let overrideRepo: CandidateRepository | null = null;

export function setCandidateRepositoryForTests(
  repo: CandidateRepository | null,
): void {
  overrideRepo = repo;
}

export function getCandidateRepository(): CandidateRepository {
  if (overrideRepo) {
    return overrideRepo;
  }
  return {
    listCandidates: supabaseRepo.listCandidates,
    getCandidate: supabaseRepo.getCandidate,
    updateCandidateStatus: supabaseRepo.updateCandidateStatus,
    upsertCandidateByFingerprint: supabaseRepo.upsertCandidateByFingerprint,
    addEvidence: supabaseRepo.addEvidence,
    addAction: supabaseRepo.addAction,
  };
}
