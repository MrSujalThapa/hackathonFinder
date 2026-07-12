import { getServerEnv } from "@/config/env";
import type {
  AddActionInput,
  AddCandidateAnswerInput,
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
import { createMockCandidateRepository } from "@/server/candidates/mockStore";
import * as supabaseRepo from "@/server/candidates/repository";

export type CandidateRepository = {
  listCandidates: (params?: ListCandidatesParams) => Promise<ListCandidatesResult>;
  listPendingSheetSync?: (limit?: number) => Promise<CandidateCard[]>;
  getCandidate: (id: string) => Promise<CandidateDetail | null>;
  updateCandidateStatus: (
    id: string,
    status: CandidateStatus,
    metadata?: StatusChangeMetadata,
  ) => Promise<CandidateCard>;
  updateSheetMetadata: (
    id: string,
    meta: { sheetRowId: string; sheetAppendedAt?: string },
  ) => Promise<CandidateCard>;
  clearSheetMetadata?: (id: string) => Promise<CandidateCard>;
  upsertCandidateByFingerprint?: (
    input: UpsertCandidateInput,
  ) => Promise<UpsertCandidateResult>;
  addEvidence?: (
    candidateId: string,
    evidence: AddEvidenceInput,
  ) => Promise<unknown>;
  addAction?: (candidateId: string, action: AddActionInput) => Promise<unknown>;
  addCandidateAnswer?: (
    candidateId: string,
    answer: AddCandidateAnswerInput,
  ) => Promise<unknown>;
};

let overrideRepo: CandidateRepository | null = null;

export function setCandidateRepositoryForTests(
  repo: CandidateRepository | null,
): void {
  overrideRepo = repo;
}

export function isMockCandidatesEnabled(): boolean {
  const env = getServerEnv();
  if (!env.USE_MOCK_CANDIDATES) {
    return false;
  }
  const previewMockAllowed =
    env.VERCEL_ENV === "preview" && env.ALLOW_MOCK_CANDIDATES_IN_PREVIEW;
  if (env.NODE_ENV === "production" && !previewMockAllowed) {
    throw new Error(
      "USE_MOCK_CANDIDATES=true is not allowed in production. Configure a reachable Supabase project instead.",
    );
  }
  return true;
}

export function getCandidateRepository(): CandidateRepository {
  if (overrideRepo) {
    return overrideRepo;
  }

  if (isMockCandidatesEnabled()) {
    return createMockCandidateRepository();
  }

  return {
    listCandidates: supabaseRepo.listCandidates,
    listPendingSheetSync: supabaseRepo.listPendingSheetSync,
    getCandidate: supabaseRepo.getCandidate,
    updateCandidateStatus: supabaseRepo.updateCandidateStatus,
    updateSheetMetadata: supabaseRepo.updateSheetMetadata,
    clearSheetMetadata: supabaseRepo.clearSheetMetadata,
    upsertCandidateByFingerprint: supabaseRepo.upsertCandidateByFingerprint,
    addEvidence: supabaseRepo.addEvidence,
    addAction: supabaseRepo.addAction,
    addCandidateAnswer: supabaseRepo.addCandidateAnswer,
  };
}
