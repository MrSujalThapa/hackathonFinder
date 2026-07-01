import type {
  CandidateActionType,
  CandidateMode,
  CandidateStatus,
  EvidenceType,
  Json,
} from "@/lib/supabase/database.types";

export type CandidateCard = {
  id: string;
  status: CandidateStatus;
  score: number;
  name: string;
  summary: string | null;
  source: string;
  officialUrl: string | null;
  applyUrl: string | null;
  socialUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  deadline: string | null;
  location: string | null;
  mode: CandidateMode | null;
  city: string | null;
  country: string | null;
  prize: string | null;
  themes: string[];
  eligibility: string | null;
  whyMatch: string[];
  redFlags: string[];
  foundAt: string;
  lastVerified: string;
};

export type CandidateEvidence = {
  id: string;
  candidateId: string;
  type: EvidenceType;
  url: string | null;
  title: string | null;
  snippet: string | null;
  raw: Json;
  foundAt: string;
};

export type CandidateAction = {
  id: string;
  candidateId: string;
  action: CandidateActionType;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  metadata: Json;
  createdAt: string;
};

export type CandidateDetail = CandidateCard & {
  description: string | null;
  fingerprint: string;
  sourceIds: Record<string, unknown>;
  evidence: CandidateEvidence[];
  answers: Array<{
    id: string;
    question: string;
    answer: string;
    confidence: "low" | "medium" | "high" | null;
    sources: Json;
    createdAt: string;
  }>;
  actions: CandidateAction[];
};

export type ListCandidatesParams = {
  status?: CandidateStatus;
  limit?: number;
  cursor?: string;
};

export type ListCandidatesResult = {
  candidates: CandidateCard[];
  nextCursor?: string;
};

export type UpsertCandidateInput = {
  fingerprint: string;
  name: string;
  source: string;
  status?: CandidateStatus;
  score?: number;
  officialUrl?: string | null;
  applyUrl?: string | null;
  socialUrl?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  deadline?: string | null;
  location?: string | null;
  mode?: CandidateMode | null;
  city?: string | null;
  country?: string | null;
  prize?: string | null;
  themes?: string[];
  eligibility?: string | null;
  description?: string | null;
  summary?: string | null;
  whyMatch?: string[];
  redFlags?: string[];
  sourceIds?: Record<string, unknown>;
  foundAt?: string;
  lastVerified?: string;
};

export type UpsertCandidateResult = {
  candidate: CandidateCard;
  isNew: boolean;
};

export type AddEvidenceInput = {
  type: EvidenceType;
  url?: string | null;
  title?: string | null;
  snippet?: string | null;
  raw?: Json;
  foundAt?: string;
};

export type AddActionInput = {
  action: CandidateActionType;
  previousStatus?: string | null;
  newStatus?: string | null;
  reason?: string | null;
  metadata?: Json;
};

export type StatusChangeMetadata = {
  reason?: string;
  metadata?: Json;
};
