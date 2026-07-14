import type { AddActionInput } from "@/core/candidates/types";
import type { Database } from "@/lib/supabase/database.types";
import { createServiceSupabaseClient } from "@/lib/supabase/createServiceClient";
import type {
  CandidateInsert,
  CandidateRow,
  CandidateUpdate,
  EvidenceCreate,
  EvidenceRow,
  EvidenceUpdate,
  PersistencePlan,
} from "@/discovery/persistence/persistencePlan";

type CandidateActionInsert = Database["public"]["Tables"]["candidate_actions"]["Insert"];
type CandidateUpdateRow = { id: string } & CandidateUpdate["payload"];
type EvidenceUpdateRow = { id: string } & EvidenceUpdate["payload"];

export type BatchPersistenceMetrics = {
  databaseCalls: number;
  chunks: Record<string, number>;
  retries: number;
  splitBatches: number;
};

export type BatchPersistenceChunkSizes = {
  candidateLookup: number;
  candidateWrite: number;
  evidenceLookup: number;
  evidenceWrite: number;
  actionWrite: number;
};

export type BatchPersistenceRepositoryOptions = {
  chunkSizes?: Partial<BatchPersistenceChunkSizes>;
  maxSplitDepth?: number;
};

export type BatchPersistenceAdapter = {
  selectCandidatesByFingerprints(fingerprints: string[]): Promise<CandidateRow[]>;
  insertCandidates(rows: CandidateInsert[]): Promise<CandidateRow[]>;
  upsertCandidateUpdates(rows: CandidateUpdateRow[]): Promise<CandidateRow[]>;
  selectEvidenceByCandidateIds(candidateIds: string[]): Promise<EvidenceRow[]>;
  insertEvidence(rows: EvidenceCreate["row"][]): Promise<EvidenceRow[]>;
  upsertEvidenceUpdates(rows: EvidenceUpdateRow[]): Promise<EvidenceRow[]>;
  insertActions(rows: CandidateActionInsert[]): Promise<unknown[]>;
};

export type BatchPersistenceWriteResult = {
  createdCandidates: CandidateRow[];
  updatedCandidates: CandidateRow[];
  createdEvidence: EvidenceRow[];
  updatedEvidence: EvidenceRow[];
  createdActions: unknown[];
  metrics: BatchPersistenceMetrics;
};

const DEFAULT_CHUNK_SIZES: BatchPersistenceChunkSizes = {
  candidateLookup: 250,
  candidateWrite: 250,
  evidenceLookup: 250,
  evidenceWrite: 500,
  actionWrite: 500,
};

function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function emptyMetrics(): BatchPersistenceMetrics {
  return {
    databaseCalls: 0,
    chunks: {},
    retries: 0,
    splitBatches: 0,
  };
}

export class BatchPersistenceRepository {
  private readonly chunkSizes: BatchPersistenceChunkSizes;
  private readonly maxSplitDepth: number;

  constructor(
    private readonly adapter: BatchPersistenceAdapter,
    options: BatchPersistenceRepositoryOptions = {},
  ) {
    this.chunkSizes = { ...DEFAULT_CHUNK_SIZES, ...(options.chunkSizes ?? {}) };
    this.maxSplitDepth = options.maxSplitDepth ?? 3;
  }

  async fetchCandidatesByFingerprints(
    fingerprints: string[],
    metrics = emptyMetrics(),
  ): Promise<{ rows: CandidateRow[]; metrics: BatchPersistenceMetrics }> {
    const unique = [...new Set(fingerprints)].sort();
    const rows: CandidateRow[] = [];
    for (const chunk of chunksOf(unique, this.chunkSizes.candidateLookup)) {
      metrics.databaseCalls += 1;
      metrics.chunks.candidateLookup = (metrics.chunks.candidateLookup ?? 0) + 1;
      rows.push(...(await this.adapter.selectCandidatesByFingerprints(chunk)));
    }
    return { rows, metrics };
  }

  async fetchEvidenceByCandidateIds(
    candidateIds: string[],
    metrics = emptyMetrics(),
  ): Promise<{ rows: EvidenceRow[]; metrics: BatchPersistenceMetrics }> {
    const unique = [...new Set(candidateIds)].sort();
    const rows: EvidenceRow[] = [];
    for (const chunk of chunksOf(unique, this.chunkSizes.evidenceLookup)) {
      metrics.databaseCalls += 1;
      metrics.chunks.evidenceLookup = (metrics.chunks.evidenceLookup ?? 0) + 1;
      rows.push(...(await this.adapter.selectEvidenceByCandidateIds(chunk)));
    }
    return { rows, metrics };
  }

  estimateWriteCalls(plan: PersistencePlan): number {
    return (
      chunksOf(plan.candidateCreates, this.chunkSizes.candidateWrite).length +
      chunksOf(plan.candidateUpdates, this.chunkSizes.candidateWrite).length +
      chunksOf(plan.evidenceCreates, this.chunkSizes.evidenceWrite).length +
      chunksOf(plan.evidenceUpdates, this.chunkSizes.evidenceWrite).length +
      chunksOf(plan.actionsToCreate, this.chunkSizes.actionWrite).length
    );
  }

  async writePlan(plan: PersistencePlan): Promise<BatchPersistenceWriteResult> {
    const metrics = emptyMetrics();
    const createdCandidates = await this.writeChunked(
      "candidateInsert",
      plan.candidateCreates.map((item) => item.row),
      this.chunkSizes.candidateWrite,
      (rows) => this.adapter.insertCandidates(rows),
      metrics,
    );
    const updatedCandidates = await this.writeChunked(
      "candidateUpdate",
      plan.candidateUpdates.map((item) => ({ id: item.id, ...item.payload })),
      this.chunkSizes.candidateWrite,
      (rows) => this.adapter.upsertCandidateUpdates(rows),
      metrics,
    );
    const createdEvidence = await this.writeChunked(
      "evidenceInsert",
      plan.evidenceCreates.map((item) => item.row),
      this.chunkSizes.evidenceWrite,
      (rows) => this.adapter.insertEvidence(rows),
      metrics,
    );
    const updatedEvidence = await this.writeChunked(
      "evidenceUpdate",
      plan.evidenceUpdates.map((item) => ({ id: item.id, ...item.payload })),
      this.chunkSizes.evidenceWrite,
      (rows) => this.adapter.upsertEvidenceUpdates(rows),
      metrics,
    );
    const createdActions = await this.writeChunked(
      "actionInsert",
      plan.actionsToCreate.map((item) => actionRow(item.candidateId, item.action)),
      this.chunkSizes.actionWrite,
      (rows) => this.adapter.insertActions(rows),
      metrics,
    );

    return {
      createdCandidates,
      updatedCandidates,
      createdEvidence,
      updatedEvidence,
      createdActions,
      metrics,
    };
  }

  private async writeChunked<TInput, TOutput>(
    name: string,
    rows: TInput[],
    chunkSize: number,
    write: (rows: TInput[]) => Promise<TOutput[]>,
    metrics: BatchPersistenceMetrics,
  ): Promise<TOutput[]> {
    const out: TOutput[] = [];
    for (const chunk of chunksOf(rows, chunkSize)) {
      out.push(...(await this.writeWithSplitRetry(name, chunk, write, metrics, 0)));
    }
    return out;
  }

  private async writeWithSplitRetry<TInput, TOutput>(
    name: string,
    rows: TInput[],
    write: (rows: TInput[]) => Promise<TOutput[]>,
    metrics: BatchPersistenceMetrics,
    depth: number,
  ): Promise<TOutput[]> {
    if (rows.length === 0) return [];
    metrics.databaseCalls += 1;
    metrics.chunks[name] = (metrics.chunks[name] ?? 0) + 1;
    try {
      return await write(rows);
    } catch (error) {
      if (rows.length <= 1 || depth >= this.maxSplitDepth) {
        throw error;
      }
      metrics.retries += 1;
      metrics.splitBatches += 1;
      const midpoint = Math.ceil(rows.length / 2);
      const left = await this.writeWithSplitRetry(name, rows.slice(0, midpoint), write, metrics, depth + 1);
      const right = await this.writeWithSplitRetry(name, rows.slice(midpoint), write, metrics, depth + 1);
      return [...left, ...right];
    }
  }
}

function actionRow(candidateId: string, action: AddActionInput): CandidateActionInsert {
  return {
    candidate_id: candidateId,
    action: action.action,
    previous_status: action.previousStatus ?? null,
    new_status: action.newStatus ?? null,
    reason: action.reason ?? null,
    metadata: action.metadata ?? {},
  };
}

function throwSupabaseError(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`${label}: ${error.message}`);
}

export function createSupabaseBatchPersistenceAdapter(): BatchPersistenceAdapter {
  const supabase = createServiceSupabaseClient();
  return {
    async selectCandidatesByFingerprints(fingerprints) {
      const { data, error } = await supabase.from("candidates").select("*").in("fingerprint", fingerprints);
      throwSupabaseError("Failed to batch load candidates", error);
      return (data ?? []) as CandidateRow[];
    },
    async insertCandidates(rows) {
      const { data, error } = await supabase.from("candidates").insert(rows).select("*");
      throwSupabaseError("Failed to batch insert candidates", error);
      return (data ?? []) as CandidateRow[];
    },
    async upsertCandidateUpdates(rows) {
      const { data, error } = await supabase
        .from("candidates")
        .upsert(rows as Database["public"]["Tables"]["candidates"]["Insert"][], {
          onConflict: "id",
        })
        .select("*");
      throwSupabaseError("Failed to batch update candidates", error);
      return (data ?? []) as CandidateRow[];
    },
    async selectEvidenceByCandidateIds(candidateIds) {
      const { data, error } = await supabase
        .from("candidate_evidence")
        .select("*")
        .in("candidate_id", candidateIds);
      throwSupabaseError("Failed to batch load evidence", error);
      return (data ?? []) as EvidenceRow[];
    },
    async insertEvidence(rows) {
      const { data, error } = await supabase.from("candidate_evidence").insert(rows).select("*");
      throwSupabaseError("Failed to batch insert evidence", error);
      return (data ?? []) as EvidenceRow[];
    },
    async upsertEvidenceUpdates(rows) {
      const { data, error } = await supabase
        .from("candidate_evidence")
        .upsert(rows as Database["public"]["Tables"]["candidate_evidence"]["Insert"][], {
          onConflict: "id",
        })
        .select("*");
      throwSupabaseError("Failed to batch update evidence", error);
      return (data ?? []) as EvidenceRow[];
    },
    async insertActions(rows) {
      const { data, error } = await supabase.from("candidate_actions").insert(rows).select("*");
      throwSupabaseError("Failed to batch insert actions", error);
      return data ?? [];
    },
  };
}

export function createBatchPersistenceRepository(
  options: BatchPersistenceRepositoryOptions = {},
): BatchPersistenceRepository {
  return new BatchPersistenceRepository(createSupabaseBatchPersistenceAdapter(), options);
}
